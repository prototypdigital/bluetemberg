import type { Catalog } from '../catalog/index.js';
import type { Stack } from '../types.js';
import type { DeclaredRange } from './declared.js';
import { compareSpecificity, versionSatisfies, type DetectedStacks } from './match.js';

/**
 * The live stack registry + coverage query (Milestone M5).
 *
 * The live stack set is the union of:
 *   - stacks declared by catalog packs (pack-level `stacks: string[]`)
 *   - stacks registered locally at runtime (`registerStack`)
 *   - stacks discovered by detection in the current project
 *
 * Coverage answers "do we have version-correct guidance for (stack, version)?". The version-precise
 * ranges come from the `stacks:` frontmatter of the guidance actually available (harvested by
 * `collectDeclaredRanges`), added via {@link addCoverageRange}. A catalogued pack whose
 * content declares no range for a stack contributes the wildcard `*` — name-level coverage, the
 * coarse fallback the catalog alone can express.
 */

export type StackOrigin = 'catalog' | 'local' | 'detected';

/** Why a `(stack, version)` is not covered. */
export type CoverageGapReason = 'version-uncovered' | 'no-coverage';

export interface StackRegistryEntry {
  name: Stack;
  origins: Set<StackOrigin>;
  /** Version ranges known to be covered for this stack (`"*"` = any version, from a name-level pack). */
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
export function addCoverageRange(
  registry: StackRegistry,
  name: Stack,
  range: string,
  origin: StackOrigin = 'catalog',
): void {
  const entry = ensureEntry(registry, name);
  entry.origins.add(origin);
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
 * Build the live registry from the catalog, the ranges declared by available guidance, and
 * (optionally) detected stacks.
 *
 * Precedence mirrors the sync gate: a declared range wins over the catalog's name-level tag. A
 * catalogued pack contributes the wildcard `*` for a stack **only when no range was declared for
 * that stack** — otherwise `*` would satisfy every version and flatten coverage back into a
 * name-level boolean ("some react pack exists"), which is precisely what it must not report.
 */
export function buildStackRegistry(
  catalog: Catalog,
  detected?: DetectedStacks,
  declared?: readonly DeclaredRange[],
): StackRegistry {
  const registry: StackRegistry = new Map();

  const declaredStacks = new Set<Stack>();
  for (const { stack, range, origin } of declared ?? []) {
    addCoverageRange(registry, stack, range, origin);
    declaredStacks.add(stack);
  }

  for (const pack of catalog.packs) {
    for (const stack of pack.stacks ?? []) {
      const entry = ensureEntry(registry, stack);
      entry.origins.add('catalog');
      if (!declaredStacks.has(stack)) addCoverageRange(registry, stack, '*');
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
  /**
   * Covering guidance exists: with a version, at least one covered range satisfies it; with no
   * version, at least one covered range exists at all. A stack that is only *known* (detected or
   * registered locally) with nothing covering it is `covered: false` — i.e. a coverage gap.
   */
  covered: boolean;
  /**
   * Why coverage is missing, when `covered` is false: `no-coverage` when nothing targets the stack
   * at all, `version-uncovered` when it is targeted but no covered range satisfies the version.
   * Absent when `covered` is true. Derived from the covered ranges, never from *how* the stack
   * entered the registry — so a detected-but-uncovered stack reports `no-coverage`, not a spurious
   * `version-uncovered`.
   */
  reason?: CoverageGapReason;
  /** The most-specific covered range that satisfied the version, when a version was queried. */
  matchedRange?: string;
  origins: StackOrigin[];
}

function gapReason(entry: StackRegistryEntry): CoverageGapReason {
  return entry.coveredRanges.length > 0 ? 'version-uncovered' : 'no-coverage';
}

/**
 * Answer "do we have coverage for (stack, version)?". With no version, `covered` is true only
 * when at least one covered range exists — a stack that is merely *known* (detected/registered
 * locally) but has no covering pack is `known: true, covered: false`, i.e. a coverage gap.
 * With a version, picks the most-specific satisfied range (deterministic, not declaration order).
 */
export function queryCoverage(registry: StackRegistry, stack: Stack, version?: string): CoverageResult {
  const entry = registry.get(stack);
  if (!entry) return { stack, known: false, covered: false, reason: 'no-coverage', origins: [] };
  const origins = [...entry.origins];
  if (version === undefined) {
    if (entry.coveredRanges.length === 0) {
      return { stack, known: true, covered: false, reason: 'no-coverage', origins };
    }
    return { stack, known: true, covered: true, origins };
  }
  const satisfying = entry.coveredRanges
    .filter((range) => versionSatisfies(version, range))
    .sort(compareSpecificity);
  if (satisfying.length === 0) {
    return { stack, known: true, covered: false, reason: gapReason(entry), origins };
  }
  return { stack, known: true, covered: true, matchedRange: satisfying[0], origins };
}
