import type { Platform } from '../types.js';

export function filterTargets<T>(
  targets: Partial<Record<Platform, T>>,
  platforms: Platform[],
): [Platform, T][] {
  return Object.entries(targets)
    .filter(
      (entry): entry is [string, T] => entry[1] !== undefined && platforms.includes(entry[0] as Platform),
    )
    .map(([platform, config]) => [platform as Platform, config]);
}
