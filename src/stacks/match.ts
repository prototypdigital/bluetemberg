import { Range, coerce, minVersion, prerelease, satisfies, valid, validRange } from 'semver';
import type { StackConstraint } from '../types.js';

/**
 * Stack version matching (Milestone M3).
 *
 * Semantics (see the Stacks epic):
 *  - A prerelease matches the window of the release it previews: `15.0.0-canary.3` is matched as
 *    `15.0.0`, so it gets the `>=15` / `>=15.0.0` / `15.x` rules and never the `<15` ones —
 *    regardless of how the author spelled the range (see {@link versionSatisfies}).
 *  - No match = HARD EXCLUDE (the caller drops the guidance), never an advisory no-op.
 *  - Invalid ranges never silently match — they are dropped here (and surfaced as a warning by the
 *    sync gate via `frontmatterStackIssues`), never an accidental match.
 *  - Absolute semver ranges only; `"*"` (or empty) means "any version of this stack".
 */

/** A version detected (or declared) for a stack, plus how confident we are in it. */
export type DetectionConfidence = 'declared' | 'exact' | 'coerced' | 'unknown';

export interface DetectedStack {
  /** Resolved version string (e.g. `"15.3.1"`). */
  version: string;
  confidence: DetectionConfidence;
  /** Where the version came from (e.g. `"config"`, `"node_modules"`, `"package-lock.json"`). */
  source: string;
}

export type DetectedStacks = Map<string, DetectedStack>;

/**
 * True when `range` is the name-level wildcard: `"*"` (or empty) = any version of this stack.
 * A wildcard is real coverage, but not *version* coverage — callers that rank guidance by
 * precision key on this rather than string-matching `"*"` themselves.
 */
export function isWildcardRange(range: string): boolean {
  return range === '' || range === '*';
}

/**
 * True when `range` is a valid semver range (or the wildcard `"*"`/empty = any version).
 * Note: the `"auto"` sentinel is intentionally NOT valid here — it belongs only in blueprint
 * `stacks` detection config, never in a rule's `stacks:` constraint (where it would silently
 * become match-all).
 */
export function isValidStackRange(range: string): boolean {
  if (isWildcardRange(range)) return true;
  return validRange(range) !== null;
}

/**
 * Does `version` satisfy `range`? Coerces loose version strings. A prerelease is matched as the
 * release it previews (`19.0.0-rc.1` → `19.0.0`): semver's own prerelease ordering sorts it *below*
 * `19.0.0`, which made an RC match `>=18 <19.0.0` but not `>=19.0.0` — a team trying the next major
 * silently got the previous major's rules, or none, depending on how each range was spelled. An
 * invalid range returns false (never an accidental match). The exception is a range that itself
 * names a prerelease (`19.0.0-rc.x`, `<19.0.0-rc.3`): the author pinned a specific RC/canary, so
 * the exact version is also tried against it.
 */
export function versionSatisfies(version: string, range: string): boolean {
  if (isWildcardRange(range)) return true;
  if (validRange(range) === null) return false;
  const v = coerce(version, { includePrerelease: true });
  if (!v) return false;
  if (satisfies(`${v.major}.${v.minor}.${v.patch}`, range)) return true;
  return namesPrerelease(range) && satisfies(version, range, { includePrerelease: true });
}

/** True when any comparator in the (already validated) `range` carries a prerelease tag. */
function namesPrerelease(range: string): boolean {
  return new Range(range).set.some((comparators) =>
    comparators.some((c) => c.semver.version !== undefined && prerelease(c.semver) !== null),
  );
}

/**
 * True when `range` is valid semver but no version can ever satisfy it (e.g. `>=4 <3`). Such a
 * range hard-excludes its file forever with no signal, so the sync gate warns on it.
 */
export function isUnsatisfiableRange(range: string): boolean {
  if (isWildcardRange(range) || validRange(range) === null) return false;
  return minVersion(range) === null;
}

export interface StackMatchResult {
  matched: boolean;
  /** Stacks named by the constraint that are absent from the project. */
  missing: string[];
  /** Stacks present but whose detected version is outside the declared range. */
  mismatched: Array<{ stack: string; range: string; detected: string }>;
  /** Stacks matched via a low-confidence (coerced/declared) detection — surface as a warning. */
  lowConfidence: string[];
}

/**
 * Match a rule/guardrail `stacks:` constraint against the project's detected stacks.
 *
 * A rule matches iff every named stack is present AND its detected version satisfies the range.
 * An empty/absent constraint is stack-agnostic and always matches. This is the version-aware
 * gate; the marketplace name-only gate lives in `sync/marketplace.ts`.
 */
export function matchStackConstraint(
  constraint: StackConstraint | undefined,
  detected: DetectedStacks,
): StackMatchResult {
  const result: StackMatchResult = { matched: true, missing: [], mismatched: [], lowConfidence: [] };
  if (!constraint || Object.keys(constraint).length === 0) return result;

  for (const [stack, range] of Object.entries(constraint)) {
    const det = detected.get(stack);
    if (!det) {
      result.missing.push(stack);
      result.matched = false;
      continue;
    }
    if (det.confidence === 'coerced' || det.confidence === 'unknown') {
      result.lowConfidence.push(stack);
    }
    if (!versionSatisfies(det.version, range)) {
      result.mismatched.push({ stack, range, detected: det.version });
      result.matched = false;
    }
  }
  return result;
}

/**
 * A short, human-readable reason a file was version-filtered, for the "filtered out" report.
 * Shared by rule and guardrail sync so both surfaces phrase exclusions identically.
 */
export function describeStackMismatch(result: StackMatchResult): string {
  const parts = [
    ...result.missing.map((stack) => `${stack} not present`),
    ...result.mismatched.map((m) => `${m.stack} ${m.range} (you're on ${m.detected})`),
  ];
  return parts.join('; ');
}

/**
 * The once-per-stack warning for a low-confidence detection that is gating version-tagged content.
 * One line per stack (not per file) so the actionable signal — pin this version — is not drowned.
 */
export function describeLowConfidence(stack: string, det: DetectedStack, firstLabel: string): string {
  return `${stack}@${det.version} is a low-confidence detection (${det.confidence}, from ${det.source}) gating version-tagged files (first: ${firstLabel}) — pin a version in bluetemberg.config.json for precision`;
}

/**
 * Compare two ranges by specificity for deterministic "most-specific-wins" resolution.
 * Returns a negative number when `a` is more specific (narrower) than `b`. Specificity is ranked by
 * boundedness — an exact version pin (3) > a caret/tilde range bounded both ends (2) > the count of
 * explicit comparators, each one bound (`>=15 <16` = 2) > wildcard/any (0). Ties break lexically on
 * the raw range so the result is stable across machines and never depends on declaration order.
 *
 * Note: this counts *bounds*, not digits — a longer version string is not "more specific" than a
 * tighter range (the prior digit-counting heuristic got that wrong).
 */
export function compareSpecificity(a: string, b: string): number {
  const weight = (r: string): number => {
    if (isWildcardRange(r)) return 0;
    if (valid(r) !== null) return 3; // an exact version pin is the most specific
    if (/[~^]/.test(r)) return 2; // caret/tilde bound both ends
    return (r.match(/[<>]=?/g) ?? []).length; // each explicit comparator is one bound
  };
  const diff = weight(b) - weight(a);
  return diff !== 0 ? diff : a.localeCompare(b);
}
