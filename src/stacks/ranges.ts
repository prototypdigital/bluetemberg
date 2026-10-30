import { loadCatalogSync } from '../catalog/index.js';
import { loadConfig } from '../sync/index.js';
import type { Stack } from '../types.js';
import {
  collectDeclaredRanges,
  collectPacksRepoRanges,
  packsRepoSourceDirs,
  type DeclaredRange,
} from './declared.js';
import { resolveLatestVersions, type LatestLookup, type LatestOptions } from './latest.js';
import {
  isValidStackRange,
  isWildcardRange,
  rangeHasUpperBound,
  rangesIntersect,
  unreleasedLineRange,
} from './match.js';

/**
 * Range lifecycle (#294): the two maintainer questions about the `stacks:` ranges guidance declares.
 *
 *  - **lint** — which ranges apply to versions nobody has checked the guidance against? An
 *    open-ended range (`>=3`) silently applies to every future major; a bounded range reaching past
 *    the latest released major (`>=3 <6` while the stack is on 4) does the same for the majors in
 *    between. Both read as "covered" until the new major ships and the rule turns out wrong.
 *  - **list** — which guidance declares a range for a stack, optionally narrowed to a version or
 *    range ("every rule pinned to payload 3")?
 *
 * Both read the same harvest as `coverage` (`collectDeclaredRanges`), so they see exactly the
 * guidance sync would apply — or, pointed at a packs repo, every pack's authored ranges. This module
 * returns data only; the CLI formats and prints it.
 */

/** `project` = the guidance a consuming project has available; `packs-repo` = `packages/<pack>/llm`. */
export type RangeSourceMode = 'project' | 'packs-repo';

export type RangeLintKind = 'open-ended' | 'past-latest-major';

export interface RangeLintFinding {
  kind: RangeLintKind;
  stack: Stack;
  range: string;
  /** The declaring file's id (prefixed with the pack in a packs repo). */
  from: string;
  origin: DeclaredRange['origin'];
  /** The stack's latest released version, when known. */
  latest: string | null;
  message: string;
}

export interface RangeLintReport {
  root: string;
  mode: RangeSourceMode;
  /** Version-ranged declarations examined (wildcards are name-level by design and not linted). */
  checked: number;
  findings: RangeLintFinding[];
  /** Per stack: the latest released version used for the past-latest check, and where it came from. */
  latest: LatestLookup[];
  /** Stacks whose latest major could not be determined — their ranges were not checked against it. */
  unchecked: Array<{ stack: Stack; package: string; reason: string }>;
  /** Sources of ranges that could not be read — the lint may under-report until they are fixed. */
  warnings: string[];
}

export interface RangeListEntry {
  stack: Stack;
  range: string;
  from: string;
  origin: DeclaredRange['origin'];
}

export interface RangeListReport {
  root: string;
  mode: RangeSourceMode;
  query: { stack: Stack; version: string | null };
  /** Declarations with a version range that admits the queried version/range (all, without one). */
  matches: RangeListEntry[];
  /**
   * Name-level declarations (`*`): a pack targets the stack without a range. They apply to any
   * version, so they are listed apart — they are not pinned to anything.
   */
  nameLevel: RangeListEntry[];
  warnings: string[];
}

/** Harvest the declared ranges at `root`: a packs repo's authored ranges, or a project's available guidance. */
export function collectRangesAt(root: string): {
  mode: RangeSourceMode;
  declared: DeclaredRange[];
  warnings: string[];
} {
  if (packsRepoSourceDirs(root).size > 0) {
    return { mode: 'packs-repo', declared: collectPacksRepoRanges(root), warnings: [] };
  }
  const warnings: string[] = [];
  const config = loadConfig(root);
  const declared = collectDeclaredRanges(root, config, loadCatalogSync(root), (message) =>
    warnings.push(message),
  );
  return { mode: 'project', declared, warnings };
}

function byFileThenStack(a: { from: string; stack: string }, b: { from: string; stack: string }): number {
  return a.from.localeCompare(b.from) || a.stack.localeCompare(b.stack);
}

function openEndedFinding(d: DeclaredRange, latest: string | null): RangeLintFinding {
  return {
    kind: 'open-ended',
    ...pick(d),
    latest,
    message: `"${d.range}" has no upper bound — it applies to every future ${d.stack} major unchecked`,
  };
}

function pastLatestFinding(d: DeclaredRange, latest: string): RangeLintFinding {
  return {
    kind: 'past-latest-major',
    ...pick(d),
    latest,
    message: `"${d.range}" extends past ${d.stack} ${latest}, the latest release — it already claims versions that do not exist yet`,
  };
}

function pick(d: DeclaredRange): Pick<RangeLintFinding, 'stack' | 'range' | 'from' | 'origin'> {
  return { stack: d.stack, range: d.range, from: d.from, origin: d.origin };
}

/**
 * Lint one declaration. Open-ended wins over past-latest: an unbounded range always reaches past
 * the latest major, and the fix (add an upper bound) is the same either way.
 */
function lintRange(d: DeclaredRange, latest: string | null): RangeLintFinding | null {
  if (!rangeHasUpperBound(d.range)) return openEndedFinding(d, latest);
  if (latest === null) return null;
  const unreleased = unreleasedLineRange(latest);
  if (unreleased === null || !rangesIntersect(d.range, unreleased)) return null;
  return pastLatestFinding(d, latest);
}

/**
 * Lint every version range declared at `root`. Wildcards (`*`) are skipped — an explicit "any
 * version" is a deliberate, name-level claim, not a range that drifted — and so are ranges sync
 * already rejects as invalid (it warns on those itself).
 */
export async function buildRangeLintReport(root: string, opts: LatestOptions = {}): Promise<RangeLintReport> {
  const { mode, declared, warnings } = collectRangesAt(root);
  const ranged = declared.filter((d) => !isWildcardRange(d.range) && isValidStackRange(d.range));

  const latest = await resolveLatestVersions(
    root,
    ranged.map((d) => d.stack),
    opts,
  );
  const latestByStack = new Map(latest.map((l) => [l.stack, l.latest]));

  const findings = ranged
    .map((d) => lintRange(d, latestByStack.get(d.stack) ?? null))
    .filter((f): f is RangeLintFinding => f !== null)
    .sort(byFileThenStack);

  const unchecked = latest
    .filter((l) => l.latest === null)
    .map((l) => ({ stack: l.stack, package: l.package, reason: l.note ?? 'unknown' }));

  return { root, mode, checked: ranged.length, findings, latest, unchecked, warnings };
}

/**
 * List the declarations for `stack`, narrowed to those admitting `version` when one is given. The
 * query may be an exact version (`3.4.1`), a partial one (`3` = any 3.x), or a range (`>=3 <5`):
 * a declaration matches when some version satisfies both.
 *
 * @throws When `version` is not a valid semver version or range.
 */
export function buildRangeListReport(root: string, stack: Stack, version?: string): RangeListReport {
  if (version !== undefined && !isValidStackRange(version)) {
    throw new Error(`"${version}" is not a valid semver version or range`);
  }
  const { mode, declared, warnings } = collectRangesAt(root);
  const forStack = declared.filter((d) => d.stack === stack).sort(byFileThenStack);
  const toEntry = (d: DeclaredRange): RangeListEntry => pick(d);

  const nameLevel = forStack.filter((d) => isWildcardRange(d.range)).map(toEntry);
  const matches = forStack
    .filter((d) => !isWildcardRange(d.range))
    .filter((d) => version === undefined || rangesIntersect(d.range, version))
    .map(toEntry);

  return { root, mode, query: { stack, version: version ?? null }, matches, nameLevel, warnings };
}

function describeLatest(l: LatestLookup): string {
  const when = l.checkedAt ? `, checked ${l.checkedAt.slice(0, 10)}` : '';
  const stale = l.source === 'stale-cache' ? ` [stale: ${l.note}]` : '';
  return `${l.stack} (${l.package}): ${l.latest} from ${l.source}${when}${stale}`;
}

/** Human-readable lines for `stacks lint`. */
export function formatRangeLint(report: RangeLintReport): string[] {
  const lines = report.warnings.map((w) => `WARN: ${w}`);
  const where = report.mode === 'packs-repo' ? 'packs repo' : 'project';
  lines.push(`Checked ${report.checked} version range(s) in ${where} ${report.root}`);

  const known = report.latest.filter((l) => l.latest !== null);
  if (known.length > 0) {
    lines.push('Latest releases:');
    for (const l of known) lines.push(`  ${describeLatest(l)}`);
  }
  for (const u of report.unchecked) {
    lines.push(
      `NOTE: could not check latest major for ${u.stack} (${u.reason}) — only open-ended ranges were flagged for it`,
    );
  }

  if (report.findings.length === 0) {
    lines.push('No range lifecycle issues found.');
    return lines;
  }
  lines.push(`${report.findings.length} issue(s):`);
  for (const f of report.findings) {
    lines.push(`  ✗ ${f.from}  ${f.stack}: "${f.range}"  ${f.kind}`);
    lines.push(`      ${f.message}`);
  }
  lines.push('Bound each range to the majors the guidance was checked against (e.g. ">=3 <4").');
  return lines;
}

/** Human-readable lines for `stacks list`. */
export function formatRangeList(report: RangeListReport): string[] {
  const lines = report.warnings.map((w) => `WARN: ${w}`);
  const { stack, version } = report.query;
  const label = version === null ? stack : `${stack}@${version}`;

  if (report.matches.length === 0 && report.nameLevel.length === 0) {
    lines.push(
      version === null
        ? `No guidance declares a range for ${stack}.`
        : `No guidance declares a range for ${stack} that admits ${version}.`,
    );
    return lines;
  }
  lines.push(`${report.matches.length} declaration(s) with a version range for ${label}:`);
  for (const m of report.matches) lines.push(`  ${m.from}  ${m.stack}: "${m.range}"  (${m.origin})`);
  if (report.nameLevel.length > 0) {
    lines.push(`${report.nameLevel.length} name-level declaration(s) (any ${stack} version):`);
    for (const m of report.nameLevel) lines.push(`  ${m.from}  (${m.origin})`);
  }
  return lines;
}
