import { normalize, sep } from 'node:path';
import type { BlueprintConfig, Platform, SkillTargetConfig, TargetConfig } from '../types.js';
import { DEFAULT_TARGETS } from './transform.js';
import { filterTargets } from '../utils/target-filtering.js';

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
 * Skill targets for the enabled platforms, one per output dir. Codex and Devin both load
 * `.agents/skills/`, so the dir is written (and pruned) once however many platforms share it.
 */
export function resolveSkillTargets(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): [Platform, SkillTargetConfig][] {
  const section = normalizeSection(config.targets?.skills || DEFAULT_TARGETS.skills, 'skills');
  const seen = new Set<string>();
  return filterTargets<SkillTargetConfig>(section, normalizePlatforms(platforms)).filter(([, target]) => {
    const dir = dirKey(target.dir);
    if (seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}
