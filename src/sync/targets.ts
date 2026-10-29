import { normalize } from 'node:path';
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

/** Compare output dirs regardless of `./` prefixes or trailing slashes. */
function dirKey(dir: string): string {
  return normalize(dir).replace(/\/+$/, '');
}

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
  const devin = legacy.dir === LEGACY_DEFAULT_DIRS[kind] ? devinDefault : legacy;
  if (devin) normalized.devin = devin;
  return normalized;
}

/** Rule targets for the enabled platforms, plus the transitional `.windsurf/rules/` mirror for Devin. */
export function resolveRuleTargets(
  config: BlueprintConfig,
  platforms: readonly Platform[],
): [Platform, TargetConfig][] {
  const section = normalizeSection(config.targets?.rules || DEFAULT_TARGETS.rules, 'rules');
  const targets = filterTargets<TargetConfig>(section, normalizePlatforms(platforms));
  const devin = targets.find(([platform]) => platform === DEVIN_PLATFORM);
  if (devin && dirKey(devin[1].dir) !== LEGACY_DEVIN_RULES.dir) {
    targets.push([DEVIN_PLATFORM, LEGACY_DEVIN_RULES]);
  }
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
