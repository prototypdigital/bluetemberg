import type { PresetItem, TeamProfile } from '../types.js';

/** Same logic as interactive wizard preset tags + profile. */
export function resolvePresetDefaults(presets: PresetItem[], profile: TeamProfile): PresetItem[] {
  if (profile === 'custom') return presets;

  return presets.map((p) => ({
    ...p,
    default: p.tags?.includes(profile) ?? p.default,
  }));
}
