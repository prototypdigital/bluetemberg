import { coerce, satisfies, validRange } from 'semver';
import type { StackConstraint } from '../types.js';

/**
 * Stack version matching (Milestone M3).
 *
 * Semantics (see the Stacks epic):
 *  - A range is matched with semver `satisfies`, prereleases included, so `15.0.0-canary.3`
 *    matches `>=15`.
 *  - No match = HARD EXCLUDE (the caller drops the guidance), never an advisory no-op.
 *  - Invalid ranges never silently match — they are reported by {@link invalidRanges} so the
 *    caller can warn, and treated as non-matching here.
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

/** True when `range` is a valid semver range (or the wildcard `"*"`/empty = any version). */
export function isValidStackRange(range: string): boolean {
  if (range === '' || range === '*' || range === 'auto') return true;
  return validRange(range) !== null;
}

/**
 * Does `version` satisfy `range`? Coerces loose version strings and includes prereleases so a
 * canary/rc matches its major. An invalid range returns false (never an accidental match).
 */
export function versionSatisfies(version: string, range: string): boolean {
  if (range === '' || range === '*' || range === 'auto') return true;
  if (validRange(range) === null) return false;
  const v = coerce(version, { includePrerelease: true });
  if (!v) return false;
  return satisfies(v, range, { includePrerelease: true });
}

/** The invalid ranges in a constraint, so the caller can warn and drop them. */
export function invalidRanges(constraint: StackConstraint): string[] {
  return Object.entries(constraint)
    .filter(([, range]) => !isValidStackRange(range))
    .map(([name, range]) => `${name}: "${range}"`);
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
 * Compare two ranges by specificity for deterministic "most-specific-wins" resolution.
 * Returns a negative number when `a` is more specific (narrower) than `b`. Specificity is the
 * count of comparator clauses (a proxy for boundedness); ties break lexically on the raw range
 * so the result is stable across machines and never depends on declaration order.
 */
export function compareSpecificity(a: string, b: string): number {
  const weight = (r: string): number => {
    if (r === '' || r === '*') return 0;
    // More comparators (>=, <, etc.) ⇒ more bounded ⇒ more specific.
    return (r.match(/[<>]=?|\^|~|\b\d/g) ?? []).length;
  };
  const diff = weight(b) - weight(a);
  return diff !== 0 ? diff : a.localeCompare(b);
}
