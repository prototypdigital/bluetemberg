import type { Catalog } from '../catalog/index.js';
import type { Stack } from '../types.js';
import { compareSpecificity, versionSatisfies, type DetectedStacks } from './match.js';

/**
 * The live stack registry + coverage query (Milestone M5).
 *
 * The live stack set is the union of:
 *   - stacks declared by catalog packs (pack-level `stacks: string[]`)
 *   - stacks registered locally at runtime (`registerStack`)
 *   - stacks discovered by detection in the current project
 *
 * Coverage answers "do we have version-correct guidance for (stack, version)?". Pack-level
 * catalog membership contributes a wildcard `*` range (name-level coverage); version-precise
 * ranges (from rule frontmatter, or a future scanner) are added via {@link addCoverageRange}.
 */

export type StackOrigin = 'catalog' | 'local' | 'detected';

export interface StackRegistryEntry {
  name: Stack;
  origins: Set<StackOrigin>;
  /** Version ranges known to be covered for this stack (`"*"` = any version, from name-level packs). */
  coveredRanges: string[];
  /** Version observed locally/by detection, if any. */
  version?: string;
}

export type StackRegistry = Map<Stack, StackRegistryEntry>;

function ensureEntry(registry: StackRegistry, name: Stack): StackRegistryEntry {
  let entry = registry.get(name);
  if (!entry) {
    entry = { name, origins: new Set(), coveredRanges: [] };
    registry.set(name, entry);
  }
  return entry;
}

/** Add a covered version range to a stack (deduplicated). */
export function addCoverageRange(registry: StackRegistry, name: Stack, range: string): void {
  const entry = ensureEntry(registry, name);
  entry.origins.add('catalog');
  if (!entry.coveredRanges.includes(range)) entry.coveredRanges.push(range);
}

/** Register a stack discovered locally (e.g. detection found it, or an explicit `register`). */
export function registerStack(
  registry: StackRegistry,
  name: Stack,
  version?: string,
  origin: StackOrigin = 'local',
): void {
  const entry = ensureEntry(registry, name);
  entry.origins.add(origin);
  if (version) entry.version = version;
}

/**
 * Build the live registry from the catalog and (optionally) detected stacks. Each catalog pack
 * that declares `stacks` contributes those names with a wildcard coverage range.
 */
export function buildStackRegistry(catalog: Catalog, detected?: DetectedStacks): StackRegistry {
  const registry: StackRegistry = new Map();
  for (const pack of catalog.packs) {
    for (const stack of pack.stacks ?? []) {
      const entry = ensureEntry(registry, stack);
      entry.origins.add('catalog');
      if (!entry.coveredRanges.includes('*')) entry.coveredRanges.push('*');
    }
  }
  if (detected) {
    for (const [name, det] of detected) registerStack(registry, name, det.version, 'detected');
  }
  return registry;
}

export interface CoverageResult {
  stack: Stack;
  /** The stack label exists in the live registry. */
  known: boolean;
  /** At least one covered range satisfies the queried version (or the stack is known, if no version). */
  covered: boolean;
  /** The most-specific covered range that satisfied the version, when a version was queried. */
  matchedRange?: string;
  origins: StackOrigin[];
}

/**
 * Answer "do we have coverage for (stack, version)?". With no version, `covered` mirrors `known`.
 * With a version, picks the most-specific satisfied range (deterministic, not declaration order).
 */
export function queryCoverage(registry: StackRegistry, stack: Stack, version?: string): CoverageResult {
  const entry = registry.get(stack);
  if (!entry) return { stack, known: false, covered: false, origins: [] };
  const origins = [...entry.origins];
  if (version === undefined) {
    return { stack, known: true, covered: entry.coveredRanges.length > 0, origins };
  }
  const satisfying = entry.coveredRanges
    .filter((range) => versionSatisfies(version, range))
    .sort(compareSpecificity);
  if (satisfying.length === 0) return { stack, known: true, covered: false, origins };
  return { stack, known: true, covered: true, matchedRange: satisfying[0], origins };
}
