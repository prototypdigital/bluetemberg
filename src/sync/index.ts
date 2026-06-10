import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { transformFrontmatter, DEFAULT_TARGETS } from './transform.js';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { pruneStaleOutputs } from './prune.js';
import { syncMcp } from './mcp.js';
import { syncHooks } from './hooks.js';
import { syncCommands } from './commands.js';
import { syncWindsurfWorkflows } from './windsurf-workflows.js';
import { syncCopilotPrompts } from './prompts.js';
import { runOptionalAdapters } from './adapters-runner.js';
import { syncMarketplace } from './marketplace.js';
import { syncClaudeSettings } from './settings.js';
import { syncGuardrails } from './guardrails.js';
import { filterTargets } from '../utils/target-filtering.js';
import { resolveExtendedSourceDirs, mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { resolvePackSourceDirs } from '../registry/index.js';
import { INIT_TEAM_PROFILES } from '../init/init-catalog.js';
import type {
  Platform,
  BlueprintConfig,
  SyncOptions,
  SyncResults,
  TargetConfig,
  SkillTargetConfig,
  TeamProfile,
} from '../types.js';

const VALID_PLATFORMS: readonly Platform[] = [
  'cursor',
  'claude',
  'copilot',
  'gemini',
  'windsurf',
  'claude-marketplace',
];

function validateTargets(targets: unknown, configPath: string): void {
  if (targets === undefined) {
    return;
  }
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw new Error(`Invalid config in ${configPath}: "targets" must be an object`);
  }

  const t = targets as Record<string, unknown>;
  const sections: { key: 'rules' | 'agents' | 'skills'; needsExt: boolean }[] = [
    { key: 'rules', needsExt: true },
    { key: 'agents', needsExt: true },
    { key: 'skills', needsExt: false },
  ];

  for (const { key, needsExt } of sections) {
    const section = t[key];
    if (section === undefined) {
      continue;
    }
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      throw new Error(`Invalid config in ${configPath}: "targets.${key}" must be an object`);
    }

    for (const [platformKey, value] of Object.entries(section as Record<string, unknown>)) {
      if (!VALID_PLATFORMS.includes(platformKey as Platform)) {
        throw new Error(
          `Invalid config in ${configPath}: unknown platform in targets.${key}: ${platformKey}`,
        );
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid config in ${configPath}: targets.${key}.${platformKey} must be an object`);
      }
      const v = value as Record<string, unknown>;
      if (typeof v.dir !== 'string' || v.dir.trim().length === 0) {
        throw new Error(
          `Invalid config in ${configPath}: targets.${key}.${platformKey}.dir must be a non-empty string`,
        );
      }
      if (needsExt) {
        if (typeof v.ext !== 'string' || v.ext.trim().length === 0) {
          throw new Error(
            `Invalid config in ${configPath}: targets.${key}.${platformKey}.ext must be a non-empty string`,
          );
        }
      }
    }
  }
}

function validateConfig(config: unknown, configPath: string): BlueprintConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid config in ${configPath}: expected an object`);
  }

  const cfg = config as Record<string, unknown>;

  if (!Array.isArray(cfg.platforms) || cfg.platforms.length === 0) {
    throw new Error(`Invalid config in ${configPath}: "platforms" must be a non-empty array`);
  }

  const invalid = cfg.platforms.filter((p: unknown) => !VALID_PLATFORMS.includes(p as Platform));
  if (invalid.length > 0) {
    throw new Error(`Invalid config in ${configPath}: unknown platform(s): ${invalid.join(', ')}`);
  }

  if (cfg.source !== undefined && typeof cfg.source !== 'string') {
    throw new Error(`Invalid config in ${configPath}: "source" must be a string`);
  }

  if (cfg.profile !== undefined) {
    if (typeof cfg.profile !== 'string' || !INIT_TEAM_PROFILES.includes(cfg.profile as TeamProfile)) {
      throw new Error(
        `Invalid config in ${configPath}: "profile" must be one of ${INIT_TEAM_PROFILES.join(', ')}`,
      );
    }
  }

  if (cfg.extends !== undefined) {
    const ext = cfg.extends;
    const isStringArray = Array.isArray(ext) && ext.every((e: unknown) => typeof e === 'string');
    if (typeof ext !== 'string' && !isStringArray) {
      throw new Error(`Invalid config in ${configPath}: "extends" must be a string or array of strings`);
    }
  }

  if (cfg.adapters !== undefined) {
    if (!Array.isArray(cfg.adapters) || cfg.adapters.some((a: unknown) => typeof a !== 'string')) {
      throw new Error(`Invalid config in ${configPath}: "adapters" must be an array of strings`);
    }
  }

  validateTargets(cfg.targets, configPath);

  return config as BlueprintConfig;
}

/**
 * Whether the CLI (or a script) should exit with a non-zero code after {@link sync}.
 * True when any error was recorded, or in check mode when outputs are out of sync.
 */
export function shouldExitWithFailure(results: SyncResults, checkMode: boolean): boolean {
  if (results.errors.length > 0) {
    return true;
  }
  if (checkMode && results.outOfSync > 0) {
    return true;
  }
  return false;
}

export function loadConfig(root: string): BlueprintConfig {
  const configPath = join(root, 'bluetemberg.config.json');

  if (!existsSync(configPath)) {
    return {
      platforms: ['cursor', 'claude', 'copilot'],
      source: 'llm',
      targets: DEFAULT_TARGETS,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }

  return validateConfig(raw, configPath);
}

interface SyncContext extends SyncSink {
  sourceBase: string;
  /** All source dirs in priority order: local first, then each `extends` entry. */
  sourceDirs: string[];
  config: BlueprintConfig;
  platforms: Platform[];
  verbose: boolean;
}

function recordError(ctx: SyncContext, message: string): void {
  ctx.results.errors.push(message);
  ctx.log(`  ERROR: ${message}`);
}

function recordWarning(ctx: SyncContext, message: string): void {
  ctx.results.warnings.push(message);
  ctx.log(`  WARN: ${message}`);
}

function verboseLog(ctx: SyncContext, message: string): void {
  if (ctx.verbose) ctx.log(message);
}

/**
 * Sync vendor-neutral `llm/` sources into platform-specific outputs under the project root.
 *
 * **Migration:** This function is asynchronous. If you previously called `sync(...)` without
 * `await`, upgrade to `await sync(...)` so you receive {@link SyncResults} instead of a Promise.
 *
 * @param root - Project root (directory containing `bluetemberg.config.json` and `llm/`).
 * @param options - Optional `check`, `config`, `silent`, `prune`.
 * @returns Promise resolving to write/check counts and any recorded errors.
 *
 * @example
 * ```ts
 * import { sync, loadConfig } from 'bluetemberg';
 *
 * const results = await sync(process.cwd(), { config: loadConfig(process.cwd()) });
 * ```
 */
export async function sync(root: string, options: SyncOptions = {}): Promise<SyncResults> {
  const checkMode = options.check || false;
  const verbose = Boolean(options.verbose) && !options.silent;
  const config = options.config || loadConfig(root);
  const platforms = config.platforms || ['cursor', 'claude', 'copilot'];
  const sourceBase = join(root, config.source || 'llm');
  const { dirs: extendedDirs, warnings: extendsWarnings } = resolveExtendedSourceDirs(config.extends, root);
  const { dirs: packDirs, warnings: packWarnings } = resolvePackSourceDirs(root, config.source || 'llm');
  // Priority: local sourceBase first, then extends entries, then registry packs.
  const sourceDirs = [sourceBase, ...extendedDirs, ...packDirs];

  const results: SyncResults = { synced: 0, outOfSync: 0, errors: [], warnings: [] };
  const log = options.silent ? () => {} : console.log;
  const prune = Boolean(options.prune) && !checkMode;
  const expectedOutputPaths = prune ? new Set<string>() : undefined;

  log(checkMode ? 'Checking sync status...\n' : 'Syncing AI config...\n');

  const ctx: SyncContext = {
    root,
    sourceBase,
    sourceDirs,
    config,
    platforms,
    verbose,
    checkMode,
    results,
    log,
    expectedOutputPaths,
  };

  // Surface extends and pack resolution warnings before sync output.
  for (const w of extendsWarnings) recordWarning(ctx, w);
  for (const w of packWarnings) recordWarning(ctx, w);

  if (verbose) {
    log(`Source dirs (priority order):`);
    log(`  [0] ${sourceBase} (local)`);
    for (let i = 0; i < extendedDirs.length; i++) {
      log(`  [${i + 1}] ${extendedDirs[i]} (extends[${i}])`);
    }
    const offset = 1 + extendedDirs.length;
    for (let i = 0; i < packDirs.length; i++) {
      log(`  [${offset + i}] ${packDirs[i]} (pack)`);
    }
    log('');
  }

  syncRules(ctx);
  syncAgents(ctx);
  syncSkills(ctx);
  syncCopilotInstructions(ctx);
  syncGeminiInstructions(ctx);
  syncGuardrails(ctx, (msg) => recordError(ctx, msg));
  syncMcp(ctx, (msg) => recordError(ctx, msg));
  syncHooks(ctx, (msg) => recordError(ctx, msg));
  syncCommands(ctx, (msg) => recordError(ctx, msg));
  syncWindsurfWorkflows(ctx, (msg) => recordError(ctx, msg));
  syncCopilotPrompts(ctx, (msg) => recordError(ctx, msg));

  if (ctx.platforms.includes('claude-marketplace')) {
    const projectName = basename(root);
    const pluginDefs = ctx.config.marketplace?.plugins ?? [
      { name: projectName, displayName: projectName, description: '' },
    ];
    syncMarketplace({ ...ctx, plugins: pluginDefs }, (msg) => recordError(ctx, msg));

    const remote = ctx.config.marketplace?.remote;
    if (remote) {
      syncClaudeSettings({ ...ctx, remote });
    }
  }

  await runOptionalAdapters(
    {
      root: ctx.root,
      sourceBase: ctx.sourceBase,
      platforms: ctx.platforms,
      checkMode: ctx.checkMode,
      results: ctx.results,
      log: ctx.log,
      config: ctx.config,
      expectedOutputPaths: ctx.expectedOutputPaths,
    },
    (msg) => recordError(ctx, msg),
  );

  if (prune && expectedOutputPaths && results.errors.length === 0) {
    pruneStaleOutputs({
      root,
      config,
      platforms,
      expectedPaths: expectedOutputPaths,
      log,
    });
  }

  if (checkMode) {
    if (results.outOfSync > 0) {
      log(`\n${results.outOfSync} file(s) out of sync. Run: npx bluetemberg sync`);
    } else {
      log('\nAll files in sync.');
    }
  } else {
    log(`\nDone. ${results.synced} file(s) written.`);
  }

  if (results.warnings.length > 0) {
    log(`\n${results.warnings.length} warning(s):`);
    for (const w of results.warnings) log(`  WARN: ${w}`);
  }

  if (results.errors.length > 0) {
    log(`\n${results.errors.length} error(s) occurred during sync.`);
  }

  return results;
}

/** Returns a short label for a resolved source dir path, relative to root. */
function sourceLabel(ctx: SyncContext, sourceDir: string): string {
  const idx = ctx.sourceDirs.findIndex((d) => sourceDir.startsWith(d));
  if (idx === 0) return 'local';
  if (idx > 0) return `extends[${idx - 1}]`;
  return sourceDir;
}

function syncRules(ctx: SyncContext): void {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'rules', (f) => f.endsWith('.md'));
  if (merged.size === 0) return;

  ctx.log(`Rules: ${merged.size} source files`);

  const hasExtended = ctx.sourceDirs.length > 1;
  if (hasExtended) {
    for (const [file, sourceDir] of merged) {
      verboseLog(ctx, `    ${file} [${sourceLabel(ctx, sourceDir)}]`);
    }
  }

  const ruleTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.rules || DEFAULT_TARGETS.rules,
    ctx.platforms,
  );

  for (const [platform, targetConfig] of ruleTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const [file, sourceDir] of merged) {
      try {
        const source = matter.read(join(sourceDir, file));
        const transformed = transformFrontmatter(source.data, platform);
        const output = matter.stringify(source.content, transformed);
        const outName = file.replace(/\.md$/, targetConfig.ext);
        const outPath = join(outDir, outName);

        commitPlannedWrite(ctx, outPath, output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordError(ctx, `rules/${file} -> ${platform}: ${message}`);
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${merged.size} files)`);
  }
}

function syncAgents(ctx: SyncContext): void {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');
  if (merged.size === 0) return;

  ctx.log(`Agents: ${merged.size} source files`);

  const hasExtended = ctx.sourceDirs.length > 1;
  if (hasExtended) {
    for (const [file, sourceDir] of merged) {
      verboseLog(ctx, `    ${file} [${sourceLabel(ctx, sourceDir)}]`);
    }
  }

  const agentTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.agents || DEFAULT_TARGETS.agents,
    ctx.platforms,
  );

  for (const [, targetConfig] of agentTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const [file, sourceDir] of merged) {
      try {
        const content = readFileSync(join(sourceDir, file), 'utf8');
        const outName = file.replace(/\.md$/, targetConfig.ext);
        const outPath = join(outDir, outName);

        commitPlannedWrite(ctx, outPath, content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordError(ctx, `agents/${file} -> ${targetConfig.dir}: ${message}`);
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${merged.size} files)`);
  }
}

function syncSkills(ctx: SyncContext): void {
  const merged = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  if (merged.size === 0) return;

  const skillTargets = filterTargets<SkillTargetConfig>(
    ctx.config.targets?.skills || DEFAULT_TARGETS.skills,
    ctx.platforms,
  );

  ctx.log(`Skills: ${merged.size} source directories`);

  const hasExtended = ctx.sourceDirs.length > 1;
  if (hasExtended) {
    for (const [dirName, sourceParent] of merged) {
      verboseLog(ctx, `    ${dirName}/ [${sourceLabel(ctx, sourceParent)}]`);
    }
  }

  for (const [, targetConfig] of skillTargets) {
    for (const [dirName, sourceParent] of merged) {
      try {
        const srcSkill = join(sourceParent, dirName, 'SKILL.md');
        const outDir = join(ctx.root, targetConfig.dir, dirName);
        ensureDir(outDir);

        const content = readFileSync(srcSkill, 'utf8');
        const outPath = join(outDir, 'SKILL.md');

        commitPlannedWrite(ctx, outPath, content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordError(ctx, `skills/${dirName} -> ${targetConfig.dir}: ${message}`);
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${merged.size} skills)`);
  }
}

function syncCopilotInstructions(ctx: SyncContext): void {
  if (!ctx.platforms.includes('copilot')) return;

  const agentsMd = join(ctx.root, 'AGENTS.md');
  if (!existsSync(agentsMd)) return;

  try {
    const target = join(ctx.root, '.github', 'copilot-instructions.md');
    ensureDir(join(ctx.root, '.github'));
    const content = readFileSync(agentsMd, 'utf8');

    commitPlannedWrite(ctx, target, content);

    if (!ctx.checkMode) {
      ctx.log('Copilot instructions: synced from AGENTS.md');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(ctx, `AGENTS.md -> copilot-instructions: ${message}`);
  }
}

function syncGeminiInstructions(ctx: SyncContext): void {
  if (!ctx.platforms.includes('gemini')) return;

  const agentsMd = join(ctx.root, 'AGENTS.md');
  if (!existsSync(agentsMd)) return;

  try {
    const target = join(ctx.root, 'GEMINI.md');
    const content = readFileSync(agentsMd, 'utf8');

    commitPlannedWrite(ctx, target, content);

    if (!ctx.checkMode) {
      ctx.log('Gemini instructions: synced from AGENTS.md');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(ctx, `AGENTS.md -> GEMINI.md: ${message}`);
  }
}
