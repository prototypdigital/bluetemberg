import type { Catalog } from '../catalog/index.js';
import type { StackConstraint } from '../types.js';
import { isValidStackRange } from './match.js';

/**
 * Shared stack-constraint resolution used by BOTH the marketplace build (name-level gating) and
 * project sync (version-aware gating). Keeping these in one place means the two surfaces can never
 * drift on how a file's effective stack constraint is derived.
 *
 * Resolution precedence for any file (rule/agent/skill/guardrail):
 *   1. the file's own `stacks:` frontmatter (version-precise) — wins when present
 *   2. the catalog pack-level `stacks` (coarse, name-only → wildcard `*` range)
 *   3. nothing → stack-agnostic (`{}`) → applies everywhere
 */

/**
 * Build an id → stack-constraint map from the catalog. Pack-level `stacks` are coarse, name-only
 * (`["payload"]`), so each maps to a wildcard range (`{ payload: "*" }`). A file's own `stacks:`
 * frontmatter (with version ranges) overrides this. Files with no stacks anywhere are
 * stack-agnostic and apply everywhere.
 */
export function buildStackMap(catalog: Catalog): Map<string, StackConstraint> {
  const map = new Map<string, StackConstraint>();
  for (const pack of catalog.packs) {
    const stacks = pack.stacks ?? [];
    if (stacks.length === 0) continue;
    const constraint: StackConstraint = {};
    for (const s of stacks) constraint[s] = '*';
    const ids = [
      ...(pack.rules ?? []),
      ...(pack.agents ?? []),
      ...(pack.skills ?? []),
      ...(pack.guardrails ?? []),
    ];
    for (const id of ids) map.set(id, constraint);
  }
  return map;
}

/**
 * Returns the validated stack constraint when the `stacks` key is present in frontmatter, or
 * `undefined` when absent (so the caller falls back to the catalog map). Invalid ranges are
 * dropped so a malformed range never silently matches. Mirrors `readFrontmatterProfiles`.
 */
export function readFrontmatterStacks(data: Record<string, unknown>): StackConstraint | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, 'stacks')) return undefined;
  const value = data.stacks;
  // Malformed (non-object) frontmatter falls back to catalog gating rather than widening the file
  // to stack-agnostic — otherwise a typo'd `stacks:` would re-leak a pack rule into every bundle.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const out: StackConstraint = {};
  for (const [name, range] of entries) {
    if (typeof name !== 'string' || typeof range !== 'string') continue;
    if (!isValidStackRange(range)) continue;
    out[name] = range;
  }
  // Entries were declared but every one was invalid → don't silently widen to agnostic; fall back
  // to catalog gating. An intentionally empty `stacks: {}` (no entries) stays explicitly agnostic.
  if (entries.length > 0 && Object.keys(out).length === 0) return undefined;
  return out;
}

/**
 * Report the `stacks:` frontmatter entries that {@link readFrontmatterStacks} silently dropped —
 * a range that is not valid semver, or a value that is not a string. Returned as `name: "range"`
 * strings so the caller can warn. Empty when the `stacks:` key is absent or entirely well-formed.
 *
 * Without this, a typo'd range (`">==15"`) vanishes from the constraint with no signal: the file
 * either widens to stack-agnostic (applies everywhere) or falls back to catalog gating — a silent
 * mis-gate. The gate calls this so the author sees the dropped entry instead.
 */
export function frontmatterStackIssues(data: Record<string, unknown>): string[] {
  if (!Object.prototype.hasOwnProperty.call(data, 'stacks')) return [];
  const value = data.stacks;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const issues: string[] = [];
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== 'string') {
      issues.push(`${name}: (not a string)`);
      continue;
    }
    if (!isValidStackRange(range)) issues.push(`${name}: "${range}"`);
  }
  return issues;
}

/** Resolve a file's effective stack constraint: frontmatter wins, else catalog, else agnostic. */
export function resolveStacks(
  id: string,
  frontmatterStacks: StackConstraint | undefined,
  stackMap: Map<string, StackConstraint>,
): StackConstraint {
  if (frontmatterStacks !== undefined) return frontmatterStacks;
  return stackMap.get(id) ?? {};
}
