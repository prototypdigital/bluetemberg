import type { Platform } from '../types.js';

export function filterTargets<T>(
  targets: Partial<Record<Platform, T>>,
  platforms: Platform[],
): [Platform, T][] {
  return Object.entries(targets)
    .filter(([platform]) => platforms.includes(platform as Platform))
    .map(([platform, config]) => [platform as Platform, config as T]);
}
