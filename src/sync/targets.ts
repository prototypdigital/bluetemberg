import { normalize, sep } from 'node:path';
import type { BlueprintConfig, Platform, SkillTargetConfig, TargetConfig } from '../types.js';
import { DEFAULT_TARGETS } from './transform.js';
import { filterTargets } from '../utils/target-filtering.js';
import { allowsAnyPlatform, allowsPlatform } from '../catalog/platforms.js';

/** Devin Desktop's platform id. */
export const DEVIN_PLATFORM = 'devin' satisfies Platform;

/** Windsurf became Devin Desktop; `windsurf` stays accepted as an alias for `devin`. */
export const LEGACY_DEVIN_PLATFORM = 'windsurf' satisfies Platform;

/**
 * Devin still reads `.windsurf/rules/` as a fallback, so rules are mirrored there for a transition
 * period. The mirror will be dropped in a later release.
 */
export const LEGACY_DEVIN_RULES: TargetConfig = { dir: '.windsurf/rules', ext: '.md' };

/**
 * Pre-Devin outputs bluetemberg no longer writes. `--check` reports bannered files here as stale and
 * `--prune` removes them.
 */
export const RETIRED_DEVIN_SKILLS_DIR = '.windsurf/skills';
export const RETIRED_DEVIN_WORKFLOWS_DIR = '.windsurf/workflows';

/** The dirs `init` used to write for `windsurf`; an entry still pointing there means "the default". */
const LEGACY_DEFAULT_DIRS: Record<'rules' | 'agents' | 'skills', string | undefined> = {
  rules: LEGACY_DEVIN_RULES.dir,
  agents: undefined,
  skills: RETIRED_DEVIN_SKILLS_DIR,
};

type TargetKind = keyof typeof LEGACY_DEFAULT_DIRS;

/**
 * Compare output dirs regardless of `./` prefixes, trailing slashes or the OS separator. `normalize`
 * collapses repeated separators, so at most one trailing `/` is left to drop.
 */
/** A target dir normalized for comparison: `./.agents/skills/` and `.agents/skills` are one dir. */
export function dirKey(dir: string): string {
  const key = normalize(dir).split(sep).join('/');
  return key.length > 1 && key.endsWith('/') ? key.slice(0, -1) : key;
}

/** Platforms sync targets when the config names none. */
export const DEFAULT_SYNC_PLATFORMS: readonly Platform[] = ['cursor', 'claude', 'copilot'];

/** Resolve the `windsurf` alias to `devin` and drop duplicates, keeping order. */
export function normalizePlatforms(platforms: readonly Platform[]): Platform[] {
  return [...new Set(platforms.map((p) => (p === LEGACY_DEVIN_PLATFORM ? DEVIN_PLATFORM : p)))];
}

/**
 * The platforms sync targets for a loaded config, normalized. `init` preselection (`switch-profile`),
 * `preview` and `why` all read it here so they route by the same list sync emits for.
 */
export function configuredPlatforms(config: Pick<BlueprintConfig, 'platforms'>): Platform[] {
  return normalizePlatforms(config.platforms || DEFAULT_SYNC_PLATFORMS);
}

/**
 * Re-key a `targets.<kind>.windsurf` entry as `devin`. An entry that still points at the old default
 * dir (what `init` wrote before the rename) takes the new Devin default; a custom dir is kept as is.
 * An explicit `devin` entry always wins.
 */
function normalizeSection<T extends { dir: string }>(
  section: Partial<Record<Platform, T>>,
  kind: TargetKind,
): Partial<Record<Platform, T>> {
  const legacy = section[LEGACY_DEVIN_PLATFORM];
  if (!legacy) return section;

  const normalized = { ...section };
  delete normalized[LEGACY_DEVIN_PLATFORM];
  if (normalized.devin) return normalized;

  // Safe: DEFAULT_TARGETS[kind] holds entries of the same shape as the section being normalized.
  const devinDefault = DEFAULT_TARGETS[kind].devin as T | undefined;
  // A file in a monorepo chain may hold a partial entry with no `dir`; it is an override, not the
  // old default.
  const pointsAtOldDefault =
    typeof legacy.dir === 'string' && dirKey(legacy.dir) === LEGACY_DEFAULT_DIRS[kind];
  const devin = pointsAtOldDefault ? devinDefault : legacy;
  if (devin) normalized.devin = devin;
  return normalized;
}

/**
 * Re-key every `targets.<kind>.windsurf` entry of one config file as `devin`. Run per file before a
 * monorepo chain is merged, so a child's `windsurf` override is merged onto its parent's `devin`
 * entry instead of being dropped in favor of it.
 */
export function normalizeTargets(targets: BlueprintConfig['targets']): BlueprintConfig['targets'] {
  if (!targets) return targets;
  const normalized: BlueprintConfig['targets'] = { ...targets };
  if (targets.rules) normalized.rules = normalizeSection(targets.rules, 'rules');
  if (targets.agents) normalized.agents = normalizeSection(targets.agents, 'agents');
  if (targets.skills) normalized.skills = normalizeSection(targets.skills, 'skills');
  return normalized;
}

/** Rule targets for the enabled platforms, plus the transitional `.windsurf/rules/` mirror for Devin. */
export function resolveRuleTargets(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): [Platform, TargetConfig][] {
  const section = normalizeSection(config.targets?.rules || DEFAULT_TARGETS.rules, 'rules');
  const targets = filterTargets<TargetConfig>(section, normalizePlatforms(platforms));
  if (!targets.some(([platform]) => platform === DEVIN_PLATFORM)) return targets;
  // Skip the mirror when any target (Devin's own or another platform's) already writes there:
  // two writers with different frontmatter would leave `--check` permanently out of sync.
  const mirrorTaken = targets.some(([, target]) => dirKey(target.dir) === LEGACY_DEVIN_RULES.dir);
  if (!mirrorTaken) targets.push([DEVIN_PLATFORM, LEGACY_DEVIN_RULES]);
  return targets;
}

export function resolveAgentTargets(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): [Platform, TargetConfig][] {
  const section = normalizeSection(config.targets?.agents || DEFAULT_TARGETS.agents, 'agents');
  return filterTargets<TargetConfig>(section, normalizePlatforms(platforms));
}

/**
 * Per-tool skills dir `init` used to write for Cursor. An entry still pointing there means "the
 * default" (`.agents/skills/`); the bannered skills left behind are pruned like any stale output.
 * Sync still writes a skill limited to Cursor here, the one dir no other host reads (see
 * {@link skillDirsFor}).
 */
export const RETIRED_CURSOR_SKILLS_DIR = '.cursor/skills';

/**
 * Skills dirs bluetemberg no longer writes, by the platform that used to get them. `--check` reports
 * the bannered skills left in one as stale and `--prune` removes them, unless the dir is still a
 * configured target.
 */
export const RETIRED_SKILL_DIRS: readonly { platform: Platform; dir: string }[] = [
  { platform: 'cursor', dir: RETIRED_CURSOR_SKILLS_DIR },
  { platform: DEVIN_PLATFORM, dir: RETIRED_DEVIN_SKILLS_DIR },
];

/**
 * Skills dirs a platform also reads, besides its own target, deduping by skill name. Cursor loads
 * `.cursor/skills/`, `.claude/skills/` and `.agents/skills/` and lists a name once, so its default
 * target is redundant whenever Claude's dir is written.
 */
const ALSO_READS_SKILLS: Partial<Record<Platform, readonly string[]>> = {
  cursor: ['.claude/skills'],
};

/** A skills output dir and every enabled platform that loads skills from it, writers first. */
export interface SkillOutput {
  target: SkillTargetConfig;
  platforms: Platform[];
  /** The readers among `platforms` left to this dir instead of their own (Cursor, for Claude's). */
  covered: Platform[];
}

function retireSkillDirs(
  section: Partial<Record<Platform, SkillTargetConfig>>,
): Partial<Record<Platform, SkillTargetConfig>> {
  const entry = section.cursor;
  if (!entry || typeof entry.dir !== 'string' || dirKey(entry.dir) !== RETIRED_CURSOR_SKILLS_DIR) {
    return section;
  }
  const cursorDefault = DEFAULT_TARGETS.skills.cursor;
  return cursorDefault ? { ...section, cursor: cursorDefault } : section;
}

function isDefaultSkillTarget(platform: Platform, target: SkillTargetConfig): boolean {
  const fallback = DEFAULT_TARGETS.skills[platform];
  return fallback !== undefined && dirKey(fallback.dir) === dirKey(target.dir);
}

/**
 * The dir a platform's skills can be left to instead of its own, or `undefined` when it needs its
 * own. Only a default target is dropped, and only when no other platform writes there: a dir the
 * user chose is always written.
 */
function coveringDir(
  platform: Platform,
  target: SkillTargetConfig,
  writers: ReadonlyMap<string, Platform[]>,
): string | undefined {
  const dir = dirKey(target.dir);
  if (!isDefaultSkillTarget(platform, target)) return undefined;
  if ((writers.get(dir) ?? []).some((other) => other !== platform)) return undefined;
  return ALSO_READS_SKILLS[platform]?.find((other) => other !== dir && writers.has(other));
}

/**
 * Skills output dirs for the enabled platforms, one per dir, with the platforms that read each.
 * Codex, Devin, Antigravity, Gemini CLI and Cursor share `.agents/skills/`, so the dir is written
 * (and pruned) once however many platforms share it, and Cursor is left to `.claude/skills/` when
 * that is written. A skill limited to some platforms goes to the dirs {@link skillDirsFor} picks.
 */
export function resolveSkillOutputs(config: BlueprintConfig, platforms: readonly Platform[]): SkillOutput[] {
  const section = retireSkillDirs(
    normalizeSection(config.targets?.skills || DEFAULT_TARGETS.skills, 'skills'),
  );
  const targets = filterTargets<SkillTargetConfig>(section, normalizePlatforms(platforms));
  const writers = new Map<string, Platform[]>();
  for (const [platform, target] of targets) {
    const dir = dirKey(target.dir);
    writers.set(dir, [...(writers.get(dir) ?? []), platform]);
  }

  const outputs = new Map<string, SkillOutput>();
  const coveredReaders: [string, Platform][] = [];
  for (const [platform, target] of targets) {
    const covering = coveringDir(platform, target, writers);
    if (covering) {
      coveredReaders.push([covering, platform]);
      continue;
    }
    const dir = dirKey(target.dir);
    const output = outputs.get(dir);
    if (output) output.platforms.push(platform);
    else outputs.set(dir, { target, platforms: [platform], covered: [] });
  }
  for (const [dir, platform] of coveredReaders) {
    const output = outputs.get(dir);
    output?.platforms.push(platform);
    output?.covered.push(platform);
  }
  return [...outputs.values()];
}

/** Cursor reads every shared skills dir it finds; it is the platform a skill can reach by accident. */
const PASSENGER: Platform = 'cursor';

/** The readers a skill must be allowed for to go into `output`: everyone but Cursor, when shared. */
function primaryReaders(output: SkillOutput): Platform[] {
  const others = output.platforms.filter((p) => p !== PASSENGER);
  return others.length > 0 ? others : output.platforms;
}

/**
 * The dirs a skill limited to `list` (pack or frontmatter `platforms`; `null` = every platform) is
 * written to, out of `outputs`. A shared dir takes it when one of its own readers is allowed; Cursor,
 * which reads `.claude/skills/` and `.agents/skills/` alongside their owners, never pulls a skill into
 * one, or a Cursor-only skill would reach Claude Code or Codex too. Such a skill goes to Cursor's
 * private `.cursor/skills/` instead, which no other host reads.
 */
export function skillDirsFor(
  outputs: readonly SkillOutput[],
  list: readonly string[] | null | undefined,
): SkillOutput[] {
  const chosen = outputs.filter((output) => allowsAnyPlatform(list, primaryReaders(output)));
  const cursorEnabled = outputs.some((output) => output.platforms.includes(PASSENGER));
  const cursorServed = chosen.some((output) => output.platforms.includes(PASSENGER));
  if (cursorEnabled && !cursorServed && allowsPlatform(list, PASSENGER)) {
    chosen.push({ target: { dir: RETIRED_CURSOR_SKILLS_DIR }, platforms: [PASSENGER], covered: [] });
  }
  return chosen;
}

/**
 * Enabled platforms that read skills but get none, because the config's explicit `targets.skills`
 * section leaves them out (it replaces the defaults). Configs `init` wrote before a platform got a
 * skills dir (Gemini CLI, say) are the usual cause; with no explicit section there are none.
 */
export function skillPlatformsWithoutOutput(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): Platform[] {
  if (!config.targets?.skills) return [];
  const served = new Set(resolveSkillOutputs(config, platforms).flatMap((output) => output.platforms));
  return normalizePlatforms(platforms).filter(
    (platform) => DEFAULT_TARGETS.skills[platform] !== undefined && !served.has(platform),
  );
}

/** {@link resolveSkillOutputs} as `[platform, target]` pairs, naming the first platform of each dir. */
export function resolveSkillTargets(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): [Platform, SkillTargetConfig][] {
  return resolveSkillOutputs(config, platforms).map(({ target, platforms: readers }) => [readers[0], target]);
}

/**
 * Every enabled platform that reads each skills dir, keyed by {@link dirKey}. `resolveSkillTargets`
 * keeps one entry per dir, so a dir shared by Codex, Devin and Antigravity names only one of them;
 * platform routing needs all of them, since a Devin-only skill still belongs in the shared dir.
 * A covered reader (Cursor, under Claude's dir) counts as a reader of the dir it is left to.
 */
export function skillDirReaders(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): Map<string, Platform[]> {
  return new Map(
    resolveSkillOutputs(config, platforms).map((output) => [
      dirKey(output.target.dir),
      [...output.platforms],
    ]),
  );
}
