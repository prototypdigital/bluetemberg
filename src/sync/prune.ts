import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { MARKETPLACE_PLATFORM } from '../types.js';
import type { BlueprintConfig, Platform, SkillTargetConfig, TargetConfig } from '../types.js';
import { DEFAULT_TARGETS } from './transform.js';
import { filterTargets } from '../utils/target-filtering.js';
import { hasGeneratedBanner } from './banner.js';
import { walkFiles } from '../utils/fs.js';

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
  platforms: Platform[],
  section: Partial<Record<Platform, TargetConfig>>,
  expected: Set<string>,
): void {
  for (const [, tc] of filterTargets(section, platforms)) {
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
  platforms: Platform[],
  section: Partial<Record<Platform, SkillTargetConfig>>,
  expected: Set<string>,
): void {
  for (const [, tc] of filterTargets<SkillTargetConfig>(section, platforms)) {
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
): void {
  for (const name of listDir(dir)) {
    if (matches(name)) consider(out, expected, join(dir, name));
  }
}

/**
 * A plugin directory is bluetemberg's as a whole when every Markdown file in it carries the banner
 * (and there is at least one). Its `plugin.json` / `hooks.json` cannot carry a banner, but with that
 * evidence they are generated too and go with the directory; otherwise they stay (unverifiable).
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
    for (const sub of ['rules', 'agents']) {
      const dir = join(pluginDir, sub);
      for (const name of listDir(dir)) {
        if (name.endsWith('.md')) markdown.push({ path: join(dir, name), cleanupDirs: [dir, pluginDir] });
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
  }

  const marketplaceJson = join(root, '.claude-plugin', 'marketplace.json');
  if (existsSync(marketplaceJson)) consider(out, expected, marketplaceJson, [join(root, '.claude-plugin')]);
}

function collectSingleton(out: StaleOutput[], absPath: string, expected: Set<string>): void {
  if (existsSync(absPath)) consider(out, expected, absPath);
}

/**
 * Every file under a managed output location that the current pass did not write, classified by
 * whether bluetemberg can prove it generated it. Pure: reads only. `--check` reports the
 * `generated` ones as drift; `--prune` deletes them.
 */
export function collectStaleOutputs(args: StaleOutputsArgs): StaleOutput[] {
  const { root, config, platforms, expectedPaths: expected } = args;
  const out: StaleOutput[] = [];

  collectRulesAndAgents(out, root, platforms, config.targets?.rules || DEFAULT_TARGETS.rules, expected);
  const agentsSection = config.targets?.agents || DEFAULT_TARGETS.agents;
  if (agentsSection) collectRulesAndAgents(out, root, platforms, agentsSection, expected);
  const skillsSection = config.targets?.skills || DEFAULT_TARGETS.skills;
  if (skillsSection) collectSkills(out, root, platforms, skillsSection, expected);

  const isMd = (name: string) => name.endsWith('.md') && name !== 'README.md';
  if (platforms.includes('claude')) {
    collectFlatDir(out, join(root, '.claude', 'commands'), isMd, expected);
    collectSingleton(out, join(root, '.claude', 'mcp.json'), expected);
  }
  if (platforms.includes('copilot')) {
    collectFlatDir(out, join(root, '.github', 'prompts'), (n) => n.endsWith('.prompt.md'), expected);
    collectSingleton(out, join(root, '.github', 'copilot-instructions.md'), expected);
    collectSingleton(out, join(root, '.github', 'mcp.json'), expected);
  }
  if (platforms.includes('codex')) {
    collectFlatDir(out, join(root, '.codex', 'agents'), (n) => n.endsWith('.toml'), expected);
  }
  if (platforms.includes('windsurf')) {
    collectFlatDir(out, join(root, '.windsurf', 'workflows'), isMd, expected);
  }
  if (platforms.includes('gemini')) {
    collectSingleton(out, join(root, 'GEMINI.md'), expected);
  }
  if (platforms.includes('cursor')) {
    collectSingleton(out, join(root, '.cursor', 'mcp.json'), expected);
    collectSingleton(out, join(root, '.cursor', 'hooks.json'), expected);
  }
  if (platforms.includes(MARKETPLACE_PLATFORM)) {
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
export function pruneStaleOutputs(args: StaleOutputsArgs & { log: (...args: unknown[]) => void }): void {
  const { root, platforms, log } = args;
  const stale = collectStaleOutputs(args);

  let removed = 0;
  const kept: StaleOutput[] = [];
  for (const file of stale) {
    if (file.kind !== 'generated') {
      kept.push(file);
      continue;
    }
    unlinkSync(file.path);
    removed++;
    removeEmptyDirs(file.cleanupDirs);
  }
  if (platforms.includes(MARKETPLACE_PLATFORM)) removeEmptyDirs([join(root, 'plugins')]);

  if (removed > 0) {
    log(`\nPrune: removed ${removed} stale generated file(s).`);
  }
  if (kept.length > 0) {
    log(
      `\nPrune: left ${kept.length} file(s) in managed output locations that carry no bluetemberg banner (hand-written, or JSON, which cannot carry one). Delete by hand if stale:`,
    );
    for (const file of kept) log(`  ${relative(root, file.path)}`);
  }
}
