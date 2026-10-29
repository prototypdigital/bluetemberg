import type { PresetItem, RuleCollectionPreset, TeamProfile } from '../types.js';

type Routable = Pick<PresetItem, 'universal' | 'universalExcludeProfiles' | 'tags' | 'stacks'>;

/**
 * Whether a pack is pre-checked for `profile`: universal (unless excluded) or tagged for it, and,
 * when the pack targets stacks, one of them is in `projectStacks`. A Payload pack tagged for
 * backend is not preselected in a backend project without Payload.
 */
export function isPreselected(
  preset: Routable,
  profile: TeamProfile,
  projectStacks: ReadonlySet<string>,
): boolean {
  if (profile === 'custom') return false;
  if (preset.stacks && !preset.stacks.some((s) => projectStacks.has(s))) return false;
  if (preset.universal && !preset.universalExcludeProfiles?.includes(profile)) return true;
  return preset.tags?.includes(profile) ?? false;
}

/** Same logic as interactive wizard preset tags + profile. Untagged, non-universal presets keep their curated default. */
export function resolvePresetDefaults(
  presets: PresetItem[],
  profile: TeamProfile,
  projectStacks: ReadonlySet<string>,
): PresetItem[] {
  if (profile === 'custom') return presets;

  return presets.map((p) => {
    const universalHere = p.universal && !p.universalExcludeProfiles?.includes(profile);
    if (!universalHere && !p.tags) return p;
    return { ...p, default: isPreselected(p, profile, projectStacks) };
  });
}

/** Ids of the rule collections pre-checked for `profile`. */
export function preselectedCollectionIds(
  collections: RuleCollectionPreset[],
  profile: TeamProfile,
  projectStacks: ReadonlySet<string>,
): string[] {
  return collections.filter((c) => isPreselected(c, profile, projectStacks)).map((c) => c.id);
}
