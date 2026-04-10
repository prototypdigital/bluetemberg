import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { transformFrontmatter, DEFAULT_TARGETS } from './transform.js';
import { ensureDir, listFiles, listDirs } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { pruneStaleOutputs } from './prune.js';
import { syncMcp } from './mcp.js';
import { syncHooks } from './hooks.js';
import { syncCommands } from './commands.js';
import { syncCopilotPrompts } from './prompts.js';
import { runOptionalAdapters } from './adapters-runner.js';
import { filterTargets } from '../utils/target-filtering.js';
import type {
  Platform,
  BlueprintConfig,
  SyncOptions,
  SyncResults,
  TargetConfig,
  SkillTargetConfig,
} from '../types.js';

const VALID_PLATFORMS: readonly Platform[] = ['cursor', 'claude', 'copilot', 'gemini'];

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
  config: BlueprintConfig;
  platforms: Platform[];
}

function recordError(ctx: SyncContext, message: string): void {
  ctx.results.errors.push(message);
  ctx.log(`  ERROR: ${message}`);
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
 * import { sync, loadConfig } from '@prototypdigital/bluetemberg';
 *
 * const results = await sync(process.cwd(), { config: loadConfig(process.cwd()) });
 * ```
 */
export async function sync(root: string, options: SyncOptions = {}): Promise<SyncResults> {
  const checkMode = options.check || false;
  const config = options.config || loadConfig(root);
  const platforms = config.platforms || ['cursor', 'claude', 'copilot'];
  const sourceBase = join(root, config.source || 'llm');

  const results: SyncResults = { synced: 0, outOfSync: 0, errors: [] };
  const log = options.silent ? () => {} : console.log;
  const prune = Boolean(options.prune) && !checkMode;
  const expectedOutputPaths = prune ? new Set<string>() : undefined;

  log(checkMode ? 'Checking sync status...\n' : 'Syncing AI config...\n');

  const ctx: SyncContext = {
    root,
    sourceBase,
    config,
    platforms,
    checkMode,
    results,
    log,
    expectedOutputPaths,
  };

  syncRules(ctx);
  syncAgents(ctx);
  syncSkills(ctx);
  syncCopilotInstructions(ctx);
  syncGeminiInstructions(ctx);
  syncMcp(ctx, (msg) => recordError(ctx, msg));
  syncHooks(ctx, (msg) => recordError(ctx, msg));
  syncCommands(ctx, (msg) => recordError(ctx, msg));
  syncCopilotPrompts(ctx, (msg) => recordError(ctx, msg));

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

  if (results.errors.length > 0) {
    log(`\n${results.errors.length} error(s) occurred during sync.`);
  }

  return results;
}

function syncRules(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'rules');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md'));
  if (files.length === 0) return;

  ctx.log(`Rules: ${files.length} source files`);
  const ruleTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.rules || DEFAULT_TARGETS.rules,
    ctx.platforms,
  );

  for (const [platform, targetConfig] of ruleTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const file of files) {
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${files.length} files)`);
  }
}

function syncAgents(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'agents');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md') && f !== 'README.md');
  if (files.length === 0) return;

  ctx.log(`Agents: ${files.length} source files`);
  const agentTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.agents || DEFAULT_TARGETS.agents,
    ctx.platforms,
  );

  for (const [, targetConfig] of agentTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const file of files) {
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${files.length} files)`);
  }
}

function syncSkills(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'skills');
  const dirs = listDirs(sourceDir);
  if (dirs.length === 0) return;

  const skillTargets = filterTargets<SkillTargetConfig>(
    ctx.config.targets?.skills || DEFAULT_TARGETS.skills,
    ctx.platforms,
  );

  const validDirs = dirs.filter((d) => existsSync(join(sourceDir, d, 'SKILL.md')));
  if (validDirs.length === 0) return;

  ctx.log(`Skills: ${validDirs.length} source directories`);

  for (const [, targetConfig] of skillTargets) {
    for (const dirName of validDirs) {
      try {
        const srcSkill = join(sourceDir, dirName, 'SKILL.md');
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${validDirs.length} skills)`);
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
