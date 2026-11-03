import { existsSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { PLUGIN_BUNDLE_PLATFORMS } from '../types.js';
import {
  AGENT_PLUGINS_MANIFEST,
  BUNDLE_LOCK_FILE,
  COPILOT_EXTENSION_DIR,
  isBluetembergBundleLock,
} from './agent-plugins.js';
import type { BlueprintConfig, Platform, SkillTargetConfig, TargetConfig } from '../types.js';
import {
  DEVIN_PLATFORM,
  RETIRED_DEVIN_WORKFLOWS_DIR,
  RETIRED_SKILL_DIRS,
  normalizePlatforms,
  resolveAgentTargets,
  resolveRuleTargets,
  resolveSkillTargets,
} from './targets.js';
import { hasGeneratedBanner } from './banner.js';
import { walkFiles } from '../utils/fs.js';
import { legacyMcpOutputs } from './mcp.js';
import { LEGACY_GEMINI_RULES_DIR } from './gemini.js';

/** A file under a managed output location that the current sync pass did not produce. */
export interface StaleOutput {
  /** Absolute path. */
  path: string;
  /**
   * - `generated`: carries the bluetemberg banner. Safe to delete; drift when `--check` finds it.
   * - `handwritten`: could carry a banner but does not — someone wrote it. Never touched.
   * - `unverifiable`: JSON, which cannot carry a comment. Never touched; listed so it can be checked by hand.
   */
  kind: 'generated' | 'handwritten' | 'unverifiable';
  /** Directories to remove once empty after this file is deleted, deepest first. */
  cleanupDirs: string[];
  /** Set for a file in a skills dir bluetemberg no longer writes (`.cursor/skills`, …): that dir. */
  retiredDir?: string;
}

export interface StaleOutputsArgs {
  root: string;
  config: BlueprintConfig;
  platforms: Platform[];
  /** Every path the current pass wrote or checked; populated by `commitPlannedWrite`. */
  expectedPaths: Set<string>;
}

/** Extensions whose files can carry the generated-file banner (HTML comment, or `#` for TOML). */
const BANNER_CAPABLE = new Set(['.md', '.mdc', '.toml']);
/** Supporting files sync generates itself, with a `#` banner (a Codex `agents/openai.yaml`). */
const BANNERED_SUPPORTING = new Set(['.yaml', '.yml']);

function classify(abs: string): StaleOutput['kind'] {
  if (!BANNER_CAPABLE.has(extname(abs))) return 'unverifiable';
  try {
    return hasGeneratedBanner(readFileSync(abs, 'utf8')) ? 'generated' : 'handwritten';
  } catch {
    // Unreadable: treat as not ours.
    return 'handwritten';
  }
}

function consider(
  out: StaleOutput[],
  expected: Set<string>,
  absPath: string,
  cleanupDirs: string[] = [],
  kind: StaleOutput['kind'] = classify(resolve(absPath)),
): void {
  const abs = resolve(absPath);
  if (expected.has(abs)) return;
  out.push({ path: abs, kind, cleanupDirs });
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name);
}

function collectRulesAndAgents(
  out: StaleOutput[],
  root: string,
  targets: [Platform, TargetConfig][],
  expected: Set<string>,
): void {
  for (const [, tc] of targets) {
    const dir = join(root, tc.dir);
    for (const name of listDir(dir)) {
      if (name.endsWith(tc.ext)) consider(out, expected, join(dir, name));
    }
  }
}

/**
 * Directories between `file` and `base` (inclusive of `base`), deepest first — what to remove once
 * the file is gone and nothing else is left.
 */
function ancestorDirs(base: string, file: string): string[] {
  const dirs: string[] = [];
  for (let dir = dirname(file); dir.length >= base.length; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === base) break;
  }
  return dirs;
}

/**
 * A skill directory is one unit. Its `SKILL.md` carrying the banner is the evidence that the whole
 * directory is generated — supporting files (scripts, references, assets) are copied byte for
 * byte and cannot carry one themselves. Without that evidence the directory is somebody's skill
 * and only its `SKILL.md` is listed, as hand-written.
 */
function collectSkillDir(
  out: StaleOutput[],
  skillDir: string,
  expected: Set<string>,
  extraCleanup: string[] = [],
): void {
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) return;
  const kind = classify(resolve(skillMd));
  if (kind !== 'generated') {
    consider(out, expected, skillMd, [skillDir, ...extraCleanup], kind);
    return;
  }
  for (const rel of walkFiles(skillDir)) {
    const file = join(skillDir, rel);
    consider(out, expected, file, [...ancestorDirs(skillDir, file), ...extraCleanup], 'generated');
  }
}

function collectSkills(
  out: StaleOutput[],
  root: string,
  targets: [Platform, SkillTargetConfig][],
  expected: Set<string>,
): void {
  for (const [, tc] of targets) {
    const base = join(root, tc.dir);
    for (const name of listSubdirs(base)) collectSkillDir(out, join(base, name), expected);
  }
}

/** One flat managed directory: every file matching `matches` is a candidate. */
function collectFlatDir(
  out: StaleOutput[],
  dir: string,
  matches: (name: string) => boolean,
  expected: Set<string>,
  cleanupDirs: string[] = [],
): void {
  for (const name of listDir(dir)) {
    if (matches(name)) consider(out, expected, join(dir, name), cleanupDirs);
  }
}

/**
 * Outputs of the Windsurf era that Devin Desktop no longer loads: `.windsurf/workflows/` (workflows
 * were deprecated for skills). Only bannered files are removable, like everywhere else.
 */
function collectRetiredDevinOutputs(
  out: StaleOutput[],
  root: string,
  expected: Set<string>,
  isMd: (name: string) => boolean,
): void {
  const windsurfDir = join(root, '.windsurf');
  const workflowsDir = join(root, RETIRED_DEVIN_WORKFLOWS_DIR);
  collectFlatDir(out, workflowsDir, isMd, expected, [workflowsDir, windsurfDir]);
}

function sameBytes(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** The path with symlinks resolved, or the plain absolute path when it cannot be resolved. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isInsideAny(path: string, bases: string[]): boolean {
  return bases.some((base) => path === base || path.startsWith(base + sep));
}

/**
 * Whether a file in a retired skill copy is provably sync's: it carries its own banner (a Codex
 * `openai.yaml`), or the same skill in a live skills dir holds a byte-identical file at the same
 * path. The twin is read from disk, so the proof also holds while `uninstall` clears every dir.
 */
function isProvenSupportingFile(file: string, liveCopies: string[], rel: string): boolean {
  if (BANNERED_SUPPORTING.has(extname(file))) {
    try {
      if (hasGeneratedBanner(readFileSync(file, 'utf8'))) return true;
    } catch {
      return false;
    }
  }
  return liveCopies.some((live) => sameBytes(file, resolve(live, rel)));
}

/**
 * A skill left in a dir sync no longer writes. Its `SKILL.md` carrying the banner makes it sync's,
 * and removing that `SKILL.md` is what stops a tool loading the stale copy. Supporting files are
 * held to more than that: nothing rewrites this copy any more and someone may have added notes or
 * scripts next to it, so only a file identical to a live copy (or carrying its own banner) goes.
 * Any other file stays, listed as hand-written, in a dir no host loads once `SKILL.md` is gone.
 */
function collectRetiredSkillDir(
  out: StaleOutput[],
  skillDir: string,
  liveCopies: string[],
  expected: Set<string>,
  base: { dir: string; cleanup: string[] },
): void {
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd) || expected.has(resolve(skillMd))) {
    // A Cursor-only skill this pass wrote (see `skillDirsFor`): judged like any live skill.
    if (existsSync(skillMd)) collectSkillDir(out, skillDir, expected);
    return;
  }
  const retiredDir = base.dir;
  if (classify(resolve(skillMd)) !== 'generated') {
    out.push({ path: resolve(skillMd), kind: 'handwritten', cleanupDirs: [], retiredDir });
    return;
  }
  for (const rel of walkFiles(skillDir)) {
    const file = resolve(skillDir, rel);
    const proven = rel === 'SKILL.md' || isProvenSupportingFile(file, liveCopies, rel);
    const cleanupDirs = proven ? [...ancestorDirs(resolve(skillDir), file), ...base.cleanup] : [];
    out.push({ path: file, kind: proven ? 'generated' : 'handwritten', cleanupDirs, retiredDir });
  }
}

/**
 * Per-tool skills dirs sync wrote before skills were consolidated (`.cursor/skills/`, and
 * `.windsurf/skills/` from the Windsurf era), checked while their platform is enabled. A dir that
 * is, or (through a symlink) resolves into, a configured skill target is live output, so it is
 * left to {@link collectSkills}: unlinking through the link would delete what this pass wrote.
 */
function collectRetiredSkillDirs(
  out: StaleOutput[],
  root: string,
  platforms: Platform[],
  skillTargets: [Platform, SkillTargetConfig][],
  expected: Set<string>,
): void {
  // Compare absolute paths: `root` may be relative (library callers), and a dir listed twice
  // would be unlinked twice.
  const liveBases = skillTargets.map(([, tc]) => resolve(root, tc.dir));
  const liveReal = liveBases.map(realPath);
  for (const { platform, dir } of RETIRED_SKILL_DIRS) {
    if (!platforms.includes(platform)) continue;
    const base = resolve(root, dir);
    if (liveBases.includes(base) || isInsideAny(realPath(base), liveReal)) continue;
    const cleanup = [base, dirname(base)];
    for (const name of listSubdirs(base)) {
      const skillDir = join(base, name);
      if (isInsideAny(realPath(skillDir), liveReal)) continue;
      const liveCopies = liveBases.map((live) => join(live, name));
      collectRetiredSkillDir(out, skillDir, liveCopies, expected, { dir, cleanup });
    }
  }
}

/**
 * A root `plugin.json` may be one a person wrote to make a Claude-only bundle loadable elsewhere, so
 * it counts as generated only next to a bundle lock bluetemberg wrote, in bluetemberg's namespace.
 */
function collectAgentPluginManifests(
  out: StaleOutput[],
  pluginDir: string,
  expected: Set<string>,
  manifestKind: StaleOutput['kind'],
): void {
  const bundleLock = join(pluginDir, BUNDLE_LOCK_FILE);
  const hasOurLock = existsSync(bundleLock) && isBluetembergBundleLock(bundleLock);
  const kind: StaleOutput['kind'] = hasOurLock ? manifestKind : 'unverifiable';
  const rootManifest = join(pluginDir, AGENT_PLUGINS_MANIFEST);
  if (existsSync(rootManifest)) consider(out, expected, rootManifest, [pluginDir], kind);
  if (existsSync(bundleLock)) consider(out, expected, bundleLock, [dirname(bundleLock), pluginDir], kind);
}

/**
 * A plugin directory is bluetemberg's as a whole when every Markdown file in it carries the banner
 * (and there is at least one). Its JSON (`.claude-plugin/plugin.json`, `hooks/hooks.json`, the
 * Agent Plugins `plugin.json` and bundle lock) cannot carry a banner, but with that evidence it is
 * generated too and goes with the directory; otherwise it stays (unverifiable). Both bundle formats
 * are collected whichever bundle platform is on, so dropping one prunes its files from the other.
 */
function collectMarketplace(out: StaleOutput[], root: string, expected: Set<string>): void {
  const pluginsBase = join(root, 'plugins');
  for (const pluginName of listSubdirs(pluginsBase)) {
    const pluginDir = join(pluginsBase, pluginName);
    const skillsDir = join(pluginDir, 'skills');
    const markdown: { path: string; cleanupDirs: string[] }[] = [];

    const before = out.length;
    for (const skillName of listSubdirs(skillsDir)) {
      collectSkillDir(out, join(skillsDir, skillName), expected, [skillsDir, pluginDir]);
    }
    const skillKinds = out.slice(before).map((file) => file.kind);
    const copilotDir = join(pluginDir, COPILOT_EXTENSION_DIR);
    const markdownDirs = [
      { dir: join(pluginDir, 'rules'), cleanupDirs: [pluginDir] },
      { dir: join(pluginDir, 'agents'), cleanupDirs: [pluginDir] },
      { dir: join(copilotDir, 'agents'), cleanupDirs: [copilotDir, pluginDir] },
    ];
    for (const { dir, cleanupDirs } of markdownDirs) {
      for (const name of listDir(dir)) {
        if (name.endsWith('.md'))
          markdown.push({ path: join(dir, name), cleanupDirs: [dir, ...cleanupDirs] });
      }
    }

    const kinds = [...skillKinds, ...markdown.map((file) => classify(resolve(file.path)))];
    const wholePluginGenerated = kinds.length > 0 && kinds.every((kind) => kind === 'generated');
    markdown.forEach((file, i) =>
      consider(out, expected, file.path, file.cleanupDirs, kinds[skillKinds.length + i]),
    );

    const manifestKind: StaleOutput['kind'] = wholePluginGenerated ? 'generated' : 'unverifiable';
    const manifestDir = join(pluginDir, '.claude-plugin');
    const pluginJson = join(manifestDir, 'plugin.json');
    if (existsSync(pluginJson)) consider(out, expected, pluginJson, [manifestDir, pluginDir], manifestKind);
    const hooksDir = join(pluginDir, 'hooks');
    const hooksJson = join(hooksDir, 'hooks.json');
    if (existsSync(hooksJson)) consider(out, expected, hooksJson, [hooksDir, pluginDir], manifestKind);
    collectAgentPluginManifests(out, pluginDir, expected, manifestKind);
  }

  const marketplaceJson = join(root, '.claude-plugin', 'marketplace.json');
  if (existsSync(marketplaceJson)) consider(out, expected, marketplaceJson, [join(root, '.claude-plugin')]);
}

function collectSingleton(out: StaleOutput[], absPath: string, expected: Set<string>): void {
  if (existsSync(absPath)) consider(out, expected, absPath);
}

/**
 * `.claude/mcp.json` (never read by Claude Code) and `.github/mcp.json` (superseded by the root
 * `.mcp.json`, which Copilot CLI also reads) are no longer written. JSON carries no banner, so a
 * leftover one counts as generated only when its bytes are exactly what the old emitter wrote for
 * the current `llm/mcp.json`; anything else may have been edited by hand and is only listed.
 */
function collectLegacyMcp(
  out: StaleOutput[],
  absPath: string,
  legacyContent: string | undefined,
  expected: Set<string>,
): void {
  if (!existsSync(absPath)) return;
  let kind: StaleOutput['kind'] = 'unverifiable';
  try {
    if (legacyContent !== undefined && readFileSync(absPath, 'utf8') === legacyContent) kind = 'generated';
  } catch {
    // Unreadable: leave it as unverifiable.
  }
  consider(out, expected, absPath, [], kind);
}

/**
 * Every file under a managed output location that the current pass did not write, classified by
 * whether bluetemberg can prove it generated it. Pure: reads only. `--check` reports the
 * `generated` ones as drift; `--prune` deletes them.
 */
export function collectStaleOutputs(args: StaleOutputsArgs): StaleOutput[] {
  const { root, config, expectedPaths: expected } = args;
  const platforms = normalizePlatforms(args.platforms);
  const out: StaleOutput[] = [];

  collectRulesAndAgents(out, root, resolveRuleTargets(config, platforms), expected);
  collectRulesAndAgents(out, root, resolveAgentTargets(config, platforms), expected);
  const skillTargets = resolveSkillTargets(config, platforms);
  collectSkills(out, root, skillTargets, expected);

  const legacyMcp = legacyMcpOutputs(join(root, config.source || 'llm'));
  const isMd = (name: string) => name.endsWith('.md') && name !== 'README.md';
  if (platforms.includes('claude')) {
    collectFlatDir(out, join(root, '.claude', 'commands'), isMd, expected);
    collectLegacyMcp(out, join(root, '.claude', 'mcp.json'), legacyMcp?.claude, expected);
  }
  if (platforms.includes('copilot')) {
    collectFlatDir(out, join(root, '.github', 'prompts'), (n) => n.endsWith('.prompt.md'), expected);
    collectSingleton(out, join(root, '.github', 'copilot-instructions.md'), expected);
    collectLegacyMcp(out, join(root, '.github', 'mcp.json'), legacyMcp?.copilot, expected);
  }
  if (platforms.includes('codex')) {
    collectFlatDir(out, join(root, '.codex', 'agents'), (n) => n.endsWith('.toml'), expected);
  }
  if (platforms.includes(DEVIN_PLATFORM)) {
    collectRetiredDevinOutputs(out, root, expected, isMd);
  }
  collectRetiredSkillDirs(out, root, platforms, skillTargets, expected);
  if (platforms.includes('gemini') || platforms.includes('antigravity')) {
    // Both are outputs of the retired Gemini integration (a GEMINI.md copy of AGENTS.md, and rules
    // Gemini CLI never loaded). Listed so `--check` flags them and `--prune` removes the bannered ones.
    // Antigravity is included because it loads GEMINI.md, so a project that swapped `gemini` for it
    // would otherwise keep reading the stale copy.
    collectSingleton(out, join(root, 'GEMINI.md'), expected);
    const legacyDir = join(root, LEGACY_GEMINI_RULES_DIR);
    for (const name of listDir(legacyDir)) {
      if (name.endsWith('.md')) consider(out, expected, join(legacyDir, name), [legacyDir]);
    }
  }
  if (platforms.includes('cursor')) {
    collectSingleton(out, join(root, '.cursor', 'mcp.json'), expected);
    collectSingleton(out, join(root, '.cursor', 'hooks.json'), expected);
  }
  if (platforms.some((p) => PLUGIN_BUNDLE_PLATFORMS.includes(p))) {
    collectMarketplace(out, root, expected);
  }

  return out;
}

function removeEmptyDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      rmdirSync(dir);
    } catch {
      // not empty, already gone, or a race — all fine
    }
  }
}

/**
 * Deletes stale outputs the current pass did not produce — only those that carry the generated-file
 * banner. A file in a managed directory without one is somebody's work and stays; JSON cannot carry
 * a banner and stays too. Both are listed so the user can decide. Runs only after a write pass
 * with no recorded errors; `expectedPaths` must be the set `commitPlannedWrite` populated.
 */
export function pruneStaleOutputs(
  args: StaleOutputsArgs & { log: (...args: unknown[]) => void },
): StaleOutput[] {
  const { root, platforms, log } = args;
  // Overlapping targets (two platforms sharing a dir) list a file once per target; unlink it once.
  const stale = [...new Map(collectStaleOutputs(args).map((file) => [file.path, file])).values()];

  const removed: StaleOutput[] = [];
  const kept: StaleOutput[] = [];
  for (const file of stale) {
    if (file.kind !== 'generated') {
      kept.push(file);
      continue;
    }
    unlinkSync(file.path);
    removed.push(file);
    removeEmptyDirs(file.cleanupDirs);
  }
  if (platforms.some((p) => PLUGIN_BUNDLE_PLATFORMS.includes(p))) removeEmptyDirs([join(root, 'plugins')]);

  if (removed.length > 0) {
    log(`\nPrune: removed ${removed.length} stale generated file(s).`);
  }
  if (kept.length > 0) {
    log(
      `\nPrune: left ${kept.length} file(s) in managed output locations that carry no bluetemberg banner (hand-written, or JSON, which cannot carry one). Delete by hand if stale:`,
    );
    for (const file of kept) log(`  ${relative(root, file.path)}`);
  }
  return removed;
}
