import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname, resolve, relative } from 'node:path';
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
import { syncCodexRules, syncCodexAgents, syncCodexConfig } from './codex.js';
import { stripManagedBlock, AGENTS_RULES_MARKERS } from './managed-block.js';
import { runOptionalAdapters } from './adapters-runner.js';
import { syncMarketplace } from './marketplace.js';
import { syncClaudeSettings } from './settings.js';
import { syncGuardrails } from './guardrails.js';
import { syncClaudeHooks } from './claude-hooks.js';
import { filterTargets } from '../utils/target-filtering.js';
import { resolveExtendedSourceDirs, mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { resolvePackSourceDirs } from '../registry/index.js';
import { resolveExternalSourceDirs } from '../sources/registry.js';
import { INIT_TEAM_PROFILES } from '../init/init-catalog.js';
import { type Catalog, loadCatalogSync } from '../catalog/index.js';
import { detectStacks } from '../stacks/detect.js';
import {
  describeStackMismatch,
  isValidStackRange,
  matchStackConstraint,
  type DetectedStacks,
} from '../stacks/match.js';
import {
  buildStackMap,
  frontmatterStackIssues,
  readFrontmatterStacks,
  resolveStacks,
} from '../stacks/resolve.js';
import type {
  Platform,
  BlueprintConfig,
  StackConstraint,
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
  'codex',
  'claude-marketplace',
];

function validateTargets(targets: unknown, configPath: string, requireComplete = true): void {
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
      // In a monorepo chain, an entry may override only some fields and inherit the rest, so
      // presence is enforced only on the merged result (`requireComplete`). Present fields are
      // always type-checked.
      if (requireComplete || v.dir !== undefined) {
        if (typeof v.dir !== 'string' || v.dir.trim().length === 0) {
          throw new Error(
            `Invalid config in ${configPath}: targets.${key}.${platformKey}.dir must be a non-empty string`,
          );
        }
      }
      if (needsExt && (requireComplete || v.ext !== undefined)) {
        if (typeof v.ext !== 'string' || v.ext.trim().length === 0) {
          throw new Error(
            `Invalid config in ${configPath}: targets.${key}.${platformKey}.ext must be a non-empty string`,
          );
        }
      }
    }
  }
}

interface ValidateConfigOptions {
  /**
   * Require `platforms` to be present. True for a stand-alone or fully-merged config; false when
   * validating an individual file in a monorepo inheritance chain, where an ancestor may supply it.
   */
  requirePlatforms?: boolean;
}

function validateConfig(
  config: unknown,
  configPath: string,
  { requirePlatforms = true }: ValidateConfigOptions = {},
): BlueprintConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid config in ${configPath}: expected an object`);
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.platforms === undefined) {
    if (requirePlatforms) {
      throw new Error(`Invalid config in ${configPath}: "platforms" must be a non-empty array`);
    }
  } else {
    if (!Array.isArray(cfg.platforms) || cfg.platforms.length === 0) {
      throw new Error(`Invalid config in ${configPath}: "platforms" must be a non-empty array`);
    }

    const invalid = cfg.platforms.filter((p: unknown) => !VALID_PLATFORMS.includes(p as Platform));
    if (invalid.length > 0) {
      throw new Error(`Invalid config in ${configPath}: unknown platform(s): ${invalid.join(', ')}`);
    }
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

  if (cfg.root !== undefined && typeof cfg.root !== 'boolean') {
    throw new Error(`Invalid config in ${configPath}: "root" must be a boolean`);
  }

  // Validate stack pins so a typo (e.g. "15.x.0") errors loudly instead of silently hard-excluding
  // every versioned rule. Each value must be the "auto" sentinel or a valid semver version/range.
  if (cfg.stacks !== undefined) {
    if (!cfg.stacks || typeof cfg.stacks !== 'object' || Array.isArray(cfg.stacks)) {
      throw new Error(`Invalid config in ${configPath}: "stacks" must be an object`);
    }
    for (const [name, value] of Object.entries(cfg.stacks as Record<string, unknown>)) {
      if (typeof value !== 'string' || (value !== 'auto' && !isValidStackRange(value))) {
        throw new Error(
          `Invalid config in ${configPath}: stacks.${name} must be "auto" or a valid semver version/range (got ${JSON.stringify(value)})`,
        );
      }
    }
  }

  // A lenient pass (an individual file in an inheritance chain) also allows partial target entries
  // whose missing fields are supplied by an ancestor; the merged result is validated completely.
  validateTargets(cfg.targets, configPath, requirePlatforms);

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

const CONFIG_FILENAME = 'bluetemberg.config.json';

function defaultConfig(): BlueprintConfig {
  return {
    platforms: ['cursor', 'claude', 'copilot'],
    source: 'llm',
    targets: DEFAULT_TARGETS,
  };
}

function parseConfigFile(configPath: string): unknown {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }
}

/**
 * Collect `bluetemberg.config.json` files from `start` upward, nearest first. Traversal stops after
 * a config marked `root: true`, after the git root, or at the filesystem root — whichever comes
 * first. The stopping directory's own config is always included.
 */
function collectConfigFiles(start: string): { path: string; raw: unknown }[] {
  const found: { path: string; raw: unknown }[] = [];
  let dir = resolve(start);

  while (true) {
    const configPath = join(dir, CONFIG_FILENAME);
    let stop = existsSync(join(dir, '.git'));

    if (existsSync(configPath)) {
      const raw = parseConfigFile(configPath);
      found.push({ path: configPath, raw });
      if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).root === true) {
        stop = true;
      }
    }

    const parent = dirname(dir);
    if (stop || parent === dir) {
      return found;
    }
    dir = parent;
  }
}

/**
 * Heavy / generated directories never worth descending into when discovering package configs.
 * A pragmatic denylist (plus all dotfolders, skipped at the call site) — a package config is never
 * expected inside these, and crawling them (especially `node_modules`) would be slow. Dependency
 * artifact dirs across ecosystems (`target` = Rust/JVM, `vendor` = Go/PHP) are included so the walk
 * stays cheap in polyglot monorepos.
 */
const DISCOVERY_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  '.turbo',
  'target',
  'vendor',
]);

/**
 * Discover every directory at or below `root` that holds a `bluetemberg.config.json` — the inverse
 * of {@link collectConfigFiles}. The config tree IS the workspace map: a package opts into sync by
 * having a config, so recursive sync needs no npm/pnpm/yarn workspace parsing. Skips heavy/generated
 * dirs and dotfolders. Returns absolute paths, root-first then lexical, for deterministic ordering.
 */
function discoverConfigDirs(root: string): string[] {
  const start = resolve(root);
  const found: string[] = [];
  const pending = [start];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break; // unreachable given the loop guard; satisfies the type narrowing
    if (existsSync(join(dir, CONFIG_FILENAME))) found.push(dir);

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || DISCOVERY_SKIP_DIRS.has(entry.name)) continue;
        pending.push(join(dir, entry.name));
      }
    } catch {
      // Unreadable directory (permissions, race) — skip it, never fail discovery.
    }
  }

  return found.sort((a, b) => (a === start ? -1 : b === start ? 1 : a.localeCompare(b)));
}

/**
 * Load the effective config for `root`. In a monorepo, walks up the directory tree merging every
 * `bluetemberg.config.json` found (see {@link collectConfigFiles}); the most-local file wins on
 * conflicts. With no config anywhere, returns built-in defaults.
 */
export function loadConfig(root: string): BlueprintConfig {
  const files = collectConfigFiles(root);
  if (files.length === 0) {
    return defaultConfig();
  }

  // Individual files may omit `platforms` when an ancestor supplies it; defer that requirement to
  // the merged result below.
  const parsed = files.map(({ path, raw }) => validateConfig(raw, path, { requirePlatforms: false }));

  // `files` is nearest-first, so reduceRight folds ancestors into descendants — local values win.
  const effective = parsed.reduceRight((parent, child) => mergeConfigs(parent, child));

  return validateConfig(effective, files[0].path);
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Merge two `string | string[]` fields, `primary` entries first (higher priority), deduped. */
function mergeStringList(
  primary: string | string[] | undefined,
  secondary: string | string[] | undefined,
): string[] | undefined {
  const combined = [...toStringArray(primary), ...toStringArray(secondary)];
  return combined.length > 0 ? dedupe(combined) : undefined;
}

/** Per-platform deep merge: child entries override parent entries, merging their fields. */
function mergePlatformTargets<T extends object>(
  parent: Partial<Record<Platform, T>> | undefined,
  child: Partial<Record<Platform, T>> | undefined,
): Partial<Record<Platform, T>> | undefined {
  if (!parent && !child) return undefined;

  const merged: Partial<Record<Platform, T>> = { ...parent };
  for (const key of Object.keys(child ?? {}) as Platform[]) {
    // Safe: both operands are `T extends object`; the spread yields a complete `T`.
    merged[key] = { ...parent?.[key], ...child?.[key] } as T;
  }
  return merged;
}

function mergeTargets(
  parent: BlueprintConfig['targets'] = {},
  child: BlueprintConfig['targets'] = {},
): BlueprintConfig['targets'] {
  const merged: BlueprintConfig['targets'] = {};
  const rules = mergePlatformTargets(parent.rules, child.rules);
  if (rules) merged.rules = rules;
  const agents = mergePlatformTargets(parent.agents, child.agents);
  if (agents) merged.agents = agents;
  const skills = mergePlatformTargets(parent.skills, child.skills);
  if (skills) merged.skills = skills;
  return merged;
}

/**
 * Deep-merge a parent (ancestor) config with a child (more-local) config. Child wins on conflicts.
 * `platforms`, `extends`, `adapters`, and `stacks` are merged; `targets` is deep-merged per platform;
 * `source` is intentionally never inherited — it is always the local package's value.
 */
function mergeConfigs(parent: BlueprintConfig, child: BlueprintConfig): BlueprintConfig {
  const merged: BlueprintConfig = {
    ...parent,
    ...child,
    source: child.source,
    platforms: dedupe([...(parent.platforms ?? []), ...(child.platforms ?? [])]),
    targets: mergeTargets(parent.targets, child.targets),
  };

  const extendsMerged = mergeStringList(child.extends, parent.extends);
  if (extendsMerged) merged.extends = extendsMerged;
  else delete merged.extends;

  const adaptersMerged = mergeStringList(child.adapters, parent.adapters);
  if (adaptersMerged) merged.adapters = adaptersMerged;
  else delete merged.adapters;

  if (parent.stacks || child.stacks) {
    merged.stacks = { ...parent.stacks, ...child.stacks };
  }

  // `root` only controls traversal during discovery; it carries no meaning post-merge.
  delete merged.root;

  return merged;
}

interface SyncContext extends SyncSink {
  sourceBase: string;
  /** All source dirs in priority order: local, then `extends`, then packs, then external sources. */
  sourceDirs: string[];
  /** Count of `extends` dirs (for accurate per-file origin labels). */
  extendedCount: number;
  /** Count of registry-pack dirs. */
  packCount: number;
  config: BlueprintConfig;
  platforms: Platform[];
  verbose: boolean;
  /** Pack catalog, loaded once per sync (drives profile + stack id→constraint maps). */
  catalog: Catalog;
  /** Technology stacks + resolved versions detected in the project (drives version-aware gating). */
  detectedStacks: DetectedStacks;
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
 * Log the stacks (and resolved versions) this sync detected, so the user can see what the
 * version-aware gate is matching against. This is the "which version's rules did I get" signal:
 * without it, an upgrade silently swaps the rule set with nothing explaining why. No-op when no
 * stacks are detected, so a project with no stack-tagged content is unaffected.
 */
function logDetectedStacks(ctx: SyncContext): void {
  if (ctx.detectedStacks.size === 0) return;
  const parts = [...ctx.detectedStacks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, det]) => `${name}@${det.version} (${det.source})`);
  ctx.log(`Detected stacks: ${parts.join(', ')}\n`);
}

interface VersionGate {
  /** True when the file's stack constraint is satisfied by the detected stacks (or it is agnostic). */
  matched: boolean;
  /** Human-readable mismatch reason, empty when matched. */
  reason: string;
}

/**
 * Decide whether a file applies to this project given its detected stacks. Resolves the effective
 * constraint (frontmatter `stacks:` > catalog pack-level > agnostic), warns once on low-confidence
 * detection, and returns the gate decision. Stack-agnostic files (the default) always match, so a
 * project with no stack-tagged content behaves exactly as before.
 */
function gateByVersion(
  ctx: SyncContext,
  id: string,
  frontmatter: Record<string, unknown>,
  stackMap: Map<string, StackConstraint>,
  label: string,
): VersionGate {
  const issues = frontmatterStackIssues(frontmatter);
  if (issues.length > 0) {
    recordWarning(
      ctx,
      `${label}: ignored invalid stack range(s) ${issues.join(', ')} — fix the range or the file may apply to unintended versions`,
    );
  }
  const constraint = resolveStacks(id, readFrontmatterStacks(frontmatter), stackMap);
  const result = matchStackConstraint(constraint, ctx.detectedStacks);
  if (result.lowConfidence.length > 0) {
    recordWarning(
      ctx,
      `${label}: matched via low-confidence detection for ${result.lowConfidence.join(', ')} — pin a version in bluetemberg.config.json for precision`,
    );
  }
  return { matched: result.matched, reason: result.matched ? '' : describeStackMismatch(result) };
}

/**
 * Sync vendor-neutral `llm/` sources into platform-specific outputs under the project root.
 *
 * **Migration:** This function is asynchronous. If you previously called `sync(...)` without
 * `await`, upgrade to `await sync(...)` so you receive {@link SyncResults} instead of a Promise.
 *
 * @param root - Project root (directory containing `bluetemberg.config.json` and `llm/`).
 * @param options - Optional `check`, `config`, `silent`, `prune`, `verbose`, `diff`.
 * @returns Promise resolving to write/check counts and any recorded errors.
 *
 * @example
 * ```ts
 * import { sync, loadConfig } from 'bluetemberg';
 *
 * const results = await sync(process.cwd(), { config: loadConfig(process.cwd()) });
 * ```
 */
async function syncSingle(root: string, options: SyncOptions, orchestrated = false): Promise<SyncResults> {
  const checkMode = options.check || false;
  const verbose = Boolean(options.verbose) && !options.silent;
  // A diff is only meaningful in check mode (write mode produces the in-sync state outright).
  const diff = Boolean(options.diff) && checkMode;
  const config = options.config || loadConfig(root);
  const platforms = config.platforms || ['cursor', 'claude', 'copilot'];
  const sourceBase = join(root, config.source || 'llm');
  const { dirs: extendedDirs, warnings: extendsWarnings } = resolveExtendedSourceDirs(config.extends, root);
  const { dirs: packDirs, warnings: packWarnings } = resolvePackSourceDirs(root, config.source || 'llm');
  const { dirs: externalDirs, warnings: externalWarnings } = resolveExternalSourceDirs(
    root,
    config.source || 'llm',
  );
  // Priority: local sourceBase first, then extends entries, then registry packs, then external sources.
  const sourceDirs = [sourceBase, ...extendedDirs, ...packDirs, ...externalDirs];

  const results: SyncResults = { synced: 0, outOfSync: 0, errors: [], warnings: [] };
  const log = options.silent ? () => {} : console.log;
  const prune = Boolean(options.prune) && !checkMode;
  const expectedOutputPaths = prune ? new Set<string>() : undefined;

  // Loaded once and shared: the catalog backs both profile and stack id→constraint maps, and the
  // detected stacks drive version-aware rule/guardrail gating (a Payload-2 rule is hard-excluded
  // on a Payload-3 project). Detection is cheap and side-effect-free; both default to empty so a
  // project with no `stacks` declared and no stack-tagged packs syncs byte-identically to before.
  const catalog = loadCatalogSync(root);
  const detectedStacks = detectStacks(root, config);

  if (!orchestrated) log(checkMode ? 'Checking sync status...\n' : 'Syncing AI config...\n');

  const ctx: SyncContext = {
    root,
    sourceBase,
    sourceDirs,
    extendedCount: extendedDirs.length,
    packCount: packDirs.length,
    config,
    platforms,
    verbose,
    checkMode,
    diff,
    results,
    log,
    expectedOutputPaths,
    catalog,
    detectedStacks,
  };

  // Surface extends, pack, and external-source resolution warnings before sync output.
  for (const w of extendsWarnings) recordWarning(ctx, w);
  for (const w of packWarnings) recordWarning(ctx, w);
  for (const w of externalWarnings) recordWarning(ctx, w);

  logDetectedStacks(ctx);

  if (verbose) {
    log(`Source dirs (priority order):`);
    log(`  [0] ${sourceBase} (local)`);
    for (let i = 0; i < extendedDirs.length; i++) {
      log(`  [${i + 1}] ${extendedDirs[i]} (extends[${i}])`);
    }
    const packOffset = 1 + extendedDirs.length;
    for (let i = 0; i < packDirs.length; i++) {
      log(`  [${packOffset + i}] ${packDirs[i]} (pack)`);
    }
    const externalOffset = packOffset + packDirs.length;
    for (let i = 0; i < externalDirs.length; i++) {
      log(`  [${externalOffset + i}] ${externalDirs[i]} (external)`);
    }
    log('');
  }

  syncRules(ctx);
  syncAgents(ctx);
  syncSkills(ctx);
  syncCopilotInstructions(ctx);
  syncGeminiInstructions(ctx);
  // Guardrails compute their Claude hook entries; syncClaudeHooks is the single writer of the
  // `hooks` key in .claude/settings.json, composing guardrail entries with llm/hooks.claude.json.
  const guardrailClaudeHooks = syncGuardrails(ctx, (msg) => recordError(ctx, msg));
  syncClaudeHooks(
    ctx,
    guardrailClaudeHooks,
    (msg) => recordError(ctx, msg),
    (msg) => recordWarning(ctx, msg),
  );
  syncMcp(ctx, (msg) => recordError(ctx, msg));
  syncHooks(ctx, (msg) => recordError(ctx, msg));
  syncCommands(ctx, (msg) => recordError(ctx, msg));
  syncWindsurfWorkflows(ctx, (msg) => recordError(ctx, msg));
  syncCopilotPrompts(ctx, (msg) => recordError(ctx, msg));
  syncCodexRules(ctx, (msg) => recordError(ctx, msg));
  syncCodexAgents(ctx, (msg) => recordError(ctx, msg));
  syncCodexConfig(ctx, (msg) => recordError(ctx, msg));

  if (ctx.platforms.includes('claude-marketplace')) {
    const projectName = basename(root);
    const pluginDefs = ctx.config.marketplace?.plugins ?? [
      { name: projectName, displayName: projectName, description: '' },
    ];
    syncMarketplace(
      {
        ...ctx,
        plugins: pluginDefs,
        catalog,
        owner: ctx.config.marketplace?.owner,
        remote: ctx.config.marketplace?.remote,
      },
      (msg) => recordError(ctx, msg),
    );

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

  if (!orchestrated) printSummary(log, results, checkMode);

  return results;
}

/** Print the trailing summary (Done / out-of-sync, plus warning and error counts). */
function printSummary(log: (msg: string) => void, results: SyncResults, checkMode: boolean): void {
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
}

/**
 * Public sync entry point. In a monorepo, discovers every configured package at or below `root`
 * (the config tree is the workspace map) and syncs each against its own detected stacks, so a
 * single `bluetemberg sync` keeps the whole workspace in sync — no flag to forget, no CI false-green.
 *
 * Falls back to a single-package sync (byte-identical to before) when recursion is disabled, a
 * caller passes an explicit `config` (a deliberate single target), or there is nothing but the
 * root config to sync. See {@link SyncOptions.recursive}.
 */
export async function sync(root: string, options: SyncOptions = {}): Promise<SyncResults> {
  const single = options.recursive === false || Boolean(options.config);
  if (single) return syncSingle(root, options);

  const configDirs = discoverConfigDirs(root);
  const onlyRoot = configDirs.length === 1 && configDirs[0] === resolve(root);
  if (configDirs.length === 0 || onlyRoot) return syncSingle(root, options);

  const log = options.silent ? () => {} : console.log;
  const checkMode = options.check || false;
  log(`${checkMode ? 'Checking' : 'Syncing'} AI config across ${configDirs.length} package(s)...\n`);

  const aggregate: SyncResults = { synced: 0, outOfSync: 0, errors: [], warnings: [] };
  for (const dir of configDirs) {
    log(`── ${relative(root, dir) || '.'} ──`);
    // Each package loads and merges its OWN config (drop any inherited `config` override) and
    // detects its own stacks; the orchestrator owns the header and summary.
    const r = await syncSingle(dir, { ...options, config: undefined }, true);
    aggregate.synced += r.synced;
    aggregate.outOfSync += r.outOfSync;
    aggregate.errors.push(...r.errors);
    aggregate.warnings.push(...r.warnings);
    log('');
  }

  printSummary(log, aggregate, checkMode);
  return aggregate;
}

/** Returns a short label for a resolved source dir path, relative to root. */
function sourceLabel(ctx: SyncContext, sourceDir: string): string {
  const idx = ctx.sourceDirs.findIndex((d) => sourceDir.startsWith(d));
  if (idx < 0) return sourceDir;
  if (idx === 0) return 'local';

  const extendsEnd = 1 + ctx.extendedCount;
  if (idx < extendsEnd) return `extends[${idx - 1}]`;

  const packEnd = extendsEnd + ctx.packCount;
  if (idx < packEnd) return `pack[${idx - extendsEnd}]`;

  return `external[${idx - packEnd}]`;
}

/**
 * Resolve which `.md` files (rules or agents) are version-filtered out of this project. A file is
 * excluded when its stack constraint (frontmatter `stacks:` > catalog pack-level) names a stack that
 * is absent or whose detected version is outside the declared range — the version-aware gate.
 * Returns `file → reason` for the excluded files; the decision is platform-independent so it is
 * computed once. Used for both rules and agents so version-specific guidance is withheld uniformly.
 */
function resolveExcludedFiles(
  ctx: SyncContext,
  merged: Map<string, string>,
  kind: 'rules' | 'agents',
): Map<string, string> {
  const stackMap = buildStackMap(ctx.catalog);
  const excluded = new Map<string, string>();
  for (const [file, sourceDir] of merged) {
    let data: Record<string, unknown> = {};
    try {
      data = matter.read(join(sourceDir, file)).data as Record<string, unknown>;
    } catch {
      // Unreadable frontmatter → treat as stack-agnostic here; the write loop reports the read error.
    }
    const gate = gateByVersion(ctx, basename(file, '.md'), data, stackMap, `${kind}/${file}`);
    if (!gate.matched) excluded.set(file, gate.reason);
  }
  return excluded;
}

/**
 * Resolve which skill directories are version-filtered out. A skill is gated on the `stacks:`
 * frontmatter of its `SKILL.md` (id = directory name), mirroring rules/agents so a version-specific
 * skill is withheld on projects it does not target. Returns `dirName → reason` for excluded skills.
 */
function resolveExcludedSkills(ctx: SyncContext, merged: Map<string, string>): Map<string, string> {
  const stackMap = buildStackMap(ctx.catalog);
  const excluded = new Map<string, string>();
  for (const [dirName, sourceParent] of merged) {
    let data: Record<string, unknown> = {};
    try {
      data = matter.read(join(sourceParent, dirName, 'SKILL.md')).data as Record<string, unknown>;
    } catch {
      // Unreadable SKILL.md → treat as stack-agnostic; the write loop reports the read error.
    }
    const gate = gateByVersion(ctx, dirName, data, stackMap, `skills/${dirName}`);
    if (!gate.matched) excluded.set(dirName, gate.reason);
  }
  return excluded;
}

/** Log the shared "applied · filtered out by version" summary for a synced kind (id → reason). */
function logVersionFiltered(ctx: SyncContext, appliedCount: number, excluded: Map<string, string>): void {
  if (excluded.size === 0) return;
  // Making the exclusion visible turns the gate into a trust signal: the user can audit that
  // wrong-version content was correctly withheld (hidden, not wrong-here).
  ctx.log(`  ${appliedCount} applied · ${excluded.size} filtered out by version`);
  for (const [id, reason] of excluded) {
    ctx.log(`    - ${id.replace(/\.md$/, '')}: ${reason}`);
  }
}

function syncRules(ctx: SyncContext): void {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'rules', (f) => f.endsWith('.md'));
  if (merged.size === 0) return;

  const excluded = resolveExcludedFiles(ctx, merged, 'rules');
  const appliedCount = merged.size - excluded.size;

  ctx.log(`Rules: ${merged.size} source files`);
  logVersionFiltered(ctx, appliedCount, excluded);

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
      if (excluded.has(file)) continue;
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${appliedCount} files)`);
  }
}

function syncAgents(ctx: SyncContext): void {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');
  if (merged.size === 0) return;

  const excluded = resolveExcludedFiles(ctx, merged, 'agents');
  const appliedCount = merged.size - excluded.size;

  ctx.log(`Agents: ${merged.size} source files`);
  logVersionFiltered(ctx, appliedCount, excluded);

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
      if (excluded.has(file)) continue;
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${appliedCount} files)`);
  }
}

function syncSkills(ctx: SyncContext): void {
  const merged = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  if (merged.size === 0) return;

  const excluded = resolveExcludedSkills(ctx, merged);
  const appliedCount = merged.size - excluded.size;

  const skillTargets = filterTargets<SkillTargetConfig>(
    ctx.config.targets?.skills || DEFAULT_TARGETS.skills,
    ctx.platforms,
  );

  ctx.log(`Skills: ${merged.size} source directories`);
  logVersionFiltered(ctx, appliedCount, excluded);

  const hasExtended = ctx.sourceDirs.length > 1;
  if (hasExtended) {
    for (const [dirName, sourceParent] of merged) {
      verboseLog(ctx, `    ${dirName}/ [${sourceLabel(ctx, sourceParent)}]`);
    }
  }

  for (const [, targetConfig] of skillTargets) {
    for (const [dirName, sourceParent] of merged) {
      if (excluded.has(dirName)) continue;
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

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${appliedCount} skills)`);
  }
}

function syncCopilotInstructions(ctx: SyncContext): void {
  if (!ctx.platforms.includes('copilot')) return;

  const agentsMd = join(ctx.root, 'AGENTS.md');
  if (!existsSync(agentsMd)) return;

  try {
    const target = join(ctx.root, '.github', 'copilot-instructions.md');
    ensureDir(join(ctx.root, '.github'));
    // Strip the Codex rules block — Copilot gets scoped rules via .github/instructions/ already.
    const content = stripManagedBlock(readFileSync(agentsMd, 'utf8'), AGENTS_RULES_MARKERS);

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
    // Strip the Codex rules block — Gemini gets scoped rules via .gemini/context/ already.
    const content = stripManagedBlock(readFileSync(agentsMd, 'utf8'), AGENTS_RULES_MARKERS);

    commitPlannedWrite(ctx, target, content);

    if (!ctx.checkMode) {
      ctx.log('Gemini instructions: synced from AGENTS.md');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(ctx, `AGENTS.md -> GEMINI.md: ${message}`);
  }
}
