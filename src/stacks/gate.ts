import type { StackConstraint } from '../types.js';
import {
  describeStackMismatch,
  matchStackConstraint,
  type DetectedStacks,
  type StackMatchResult,
} from './match.js';
import {
  frontmatterStackIssues,
  readFrontmatterStacks,
  resolveStacksWithSource,
  type ConstraintSource,
  type StackMap,
} from './resolve.js';

/**
 * The version-aware gate decision for one file, as data. Sync (rules, agents, skills, guardrails)
 * and `bluetemberg why` all call {@link evaluateStackGate}, so the explanation `why` gives is the
 * decision sync made — never a re-implementation that could drift. Pure: no logging, no warnings;
 * each caller decides how to surface `issues` and `match.lowConfidence`.
 */
export interface StackGate {
  /** True when the constraint is satisfied by the detected stacks (or the file is stack-agnostic). */
  matched: boolean;
  /** Human-readable mismatch reason; empty when matched. */
  reason: string;
  /** The effective constraint (frontmatter `stacks:` > catalog pack-level > agnostic `{}`). */
  constraint: StackConstraint;
  /** Which tier supplied {@link constraint}. */
  constraintSource: ConstraintSource;
  match: StackMatchResult;
  /** Malformed or unsatisfiable `stacks:` entries (`name: "range"`), see `frontmatterStackIssues`. */
  issues: string[];
}

/**
 * Decide whether a file applies given `detected`. `id` is the file's id (basename without `.md`, or
 * the skill dir name) and `kindDir` the dir it was found in — together they decide pack ownership.
 */
export function evaluateStackGate(
  id: string,
  kindDir: string,
  frontmatter: Record<string, unknown>,
  stackMap: StackMap,
  detected: DetectedStacks,
): StackGate {
  const { constraint, source } = resolveStacksWithSource(
    id,
    kindDir,
    readFrontmatterStacks(frontmatter),
    stackMap,
  );
  const match = matchStackConstraint(constraint, detected);
  return {
    matched: match.matched,
    reason: match.matched ? '' : describeStackMismatch(match),
    constraint,
    constraintSource: source,
    match,
    issues: frontmatterStackIssues(frontmatter),
  };
}
