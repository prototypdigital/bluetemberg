import { basename } from 'node:path';
import { coerce, rcompare } from 'semver';
import { loadCatalogSync } from '../catalog/index.js';
import { loadConfig } from '../sync/index.js';
import { detectStacks } from './detect.js';
import { buildStackRegistry, queryCoverage } from './registry.js';
import type { DetectionConfidence } from './match.js';

/**
 * Org-repo (stack, version) scanner / coverage histogram (Milestone M6).
 *
 * MAINTAINER tooling, not an end-developer command: it answers "which version-eras are worth
 * authoring rules for?" by scanning N repos with the SAME detection that gates rules at sync
 * (reuses {@link detectStacks} unchanged — no new detection logic), folding into a
 * `(stack, version) → count` histogram, and ranking uncovered buckets against the catalog.
 *
 * Read-only. INTERNAL-ONLY: reached via `bin/cli.js` dynamic import and the MCP tool, never
 * re-exported from `src/index.ts`. Keep it off the public package contract (see issue #196).
 *
 * v1 supports two repo shapes with zero detection changes: (a) local + installed `node_modules`
 * (exact), and (b) shallow-clone with a lockfile (exact); manifest-only falls back to `coerced`.
 * GitHub-API-only scanning (no clone) is a deferred follow-up.
 */

/** Confidence ordering, lowest first — a bucket reports the least-confident detection across repos. */
const CONFIDENCE_RANK: Record<DetectionConfidence, number> = {
  unknown: 0,
  coerced: 1,
  exact: 2,
  declared: 3,
};

function leastConfident(a: DetectionConfidence, b: DetectionConfidence): DetectionConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/** Descending version order; coercible versions sort by semver, the rest fall back to lexical. */
function compareVersionsDesc(a: string, b: string): number {
  const ca = coerce(a);
  const cb = coerce(b);
  if (ca && cb) return rcompare(ca, cb);
  return b.localeCompare(a);
}

export interface VersionBucket {
  version: string;
  count: number;
  /** Resolved repo roots that detected this `(stack, version)`. */
  repos: string[];
  /** Least-confident detection seen across the contributing repos. */
  confidence: DetectionConfidence;
  covered: boolean;
  matchedRange: string | null;
}

export interface StackHistogramEntry {
  stack: string;
  /** Repos that detected this stack at any version. */
  total: number;
  /** Version buckets, ranked by count desc then version desc. */
  versions: VersionBucket[];
}

export interface ScanGap {
  stack: string;
  version: string;
  count: number;
  reason: 'version-uncovered' | 'no-coverage';
}

export interface ScanReport {
  /** Resolved roots that were scanned. */
  roots: string[];
  scanned: number;
  /** Roots where detection found zero stacks (still counted in `scanned`). */
  empty: string[];
  histogram: StackHistogramEntry[];
  /** Uncovered `(stack, version)` buckets ranked by usage — the authoring priority list. */
  gaps: ScanGap[];
}

export interface ScanOptions {
  json?: boolean;
  silent?: boolean;
  /**
   * Sink for user-facing output. Injected by the CLI (which owns `console`) so this `src/` module
   * never references `console` directly. Omitted (or `silent`) → output is discarded.
   */
  log?: (message: string) => void;
  /**
   * Root to load the catalog from (typically the maintainer's cwd). Resolves to the project cache
   * or the committed snapshot — never the scanned repos. Defaults to the first scanned root.
   */
  catalogRoot?: string;
}

function resolveSink(opts: ScanOptions): (message: string) => void {
  if (opts.silent || !opts.log) return () => {};
  return opts.log;
}

interface MutableBucket {
  count: number;
  repos: string[];
  confidence: DetectionConfidence;
}

/** Fold per-repo detection into a `stack → version → bucket` map; collect roots with no stacks. */
function accumulate(roots: string[]): { acc: Map<string, Map<string, MutableBucket>>; empty: string[] } {
  const acc = new Map<string, Map<string, MutableBucket>>();
  const empty: string[] = [];

  for (const root of roots) {
    const detected = detectStacks(root, loadConfig(root));
    if (detected.size === 0) {
      empty.push(root);
      continue;
    }
    for (const [stack, det] of detected) {
      const byVersion = acc.get(stack) ?? new Map<string, MutableBucket>();
      acc.set(stack, byVersion);
      const bucket = byVersion.get(det.version);
      if (!bucket) {
        byVersion.set(det.version, { count: 1, repos: [root], confidence: det.confidence });
        continue;
      }
      bucket.count += 1;
      bucket.repos.push(root);
      bucket.confidence = leastConfident(bucket.confidence, det.confidence);
    }
  }
  return { acc, empty };
}

/**
 * Scan `roots` and build the `(stack, version)` histogram with catalog coverage and a ranked gap
 * list. Pure (reads the repos + catalog, returns data) — exposed for the CLI, MCP, and tests.
 */
export function buildScanReport(roots: string[], catalogRoot?: string): ScanReport {
  const { acc, empty } = accumulate(roots);
  const registry = buildStackRegistry(loadCatalogSync(catalogRoot ?? roots[0] ?? '.'));

  const histogram: StackHistogramEntry[] = [];
  const gaps: ScanGap[] = [];

  for (const [stack, byVersion] of acc) {
    const versions: VersionBucket[] = [];
    let total = 0;
    for (const [version, bucket] of byVersion) {
      total += bucket.count;
      const cov = queryCoverage(registry, stack, version);
      versions.push({
        version,
        count: bucket.count,
        repos: bucket.repos,
        confidence: bucket.confidence,
        covered: cov.covered,
        matchedRange: cov.matchedRange ?? null,
      });
      if (!cov.covered) {
        gaps.push({
          stack,
          version,
          count: bucket.count,
          reason: cov.known ? 'version-uncovered' : 'no-coverage',
        });
      }
    }
    versions.sort((a, b) => b.count - a.count || compareVersionsDesc(a.version, b.version));
    histogram.push({ stack, total, versions });
  }

  histogram.sort((a, b) => b.total - a.total || a.stack.localeCompare(b.stack));
  gaps.sort(
    (a, b) =>
      b.count - a.count || a.stack.localeCompare(b.stack) || compareVersionsDesc(a.version, b.version),
  );

  return { roots, scanned: roots.length, empty, histogram, gaps };
}

const CONFIDENCE_MARK: Record<DetectionConfidence, string> = {
  declared: '✔',
  exact: '✔',
  coerced: '~',
  unknown: '~',
};

function describeCoverage(bucket: VersionBucket): string {
  if (!bucket.covered) return 'GAP';
  if (!bucket.matchedRange || bucket.matchedRange === '*') return 'covered (name-level)';
  return `covered (${bucket.matchedRange})`;
}

function printScanHuman(report: ScanReport, log: (msg: string) => void): void {
  const withStacks = report.scanned - report.empty.length;
  log(`Scanned ${report.scanned} repo(s): ${withStacks} with stacks, ${report.empty.length} empty.`);

  if (report.histogram.length === 0) {
    log('No stacks detected in any scanned repo.');
    return;
  }

  log('');
  log('Stack usage (stack → versions):');
  for (const entry of report.histogram) {
    log(`  ${entry.stack}  (${entry.total} repo${entry.total === 1 ? '' : 's'})`);
    for (const v of entry.versions) {
      const mark = CONFIDENCE_MARK[v.confidence];
      log(`    ${mark} ${v.version}  ×${v.count}  ${v.confidence}  ${describeCoverage(v)}`);
    }
  }

  if (report.gaps.length === 0) {
    log('');
    log('No coverage gaps — every detected (stack, version) is covered.');
    return;
  }

  log('');
  log('Coverage gaps (ranked by usage — author these first):');
  report.gaps.forEach((gap, i) => {
    log(`  ${i + 1}. ${gap.stack}@${gap.version}  ×${gap.count}  ${gap.reason}`);
  });
}

/**
 * `bluetemberg scan-org <paths...>` — histogram stack+version usage across N repos vs catalog
 * coverage (human table or `--json`). Read-only maintainer tooling.
 */
export function runScanOrg(roots: string[], opts: ScanOptions = {}): ScanReport {
  const report = buildScanReport(roots, opts.catalogRoot);
  const log = resolveSink(opts);
  if (opts.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    printScanHuman(report, log);
  }
  return report;
}

/** Repo basenames for a bucket — convenience for callers rendering "which repos" hints. */
export function repoNames(bucket: VersionBucket): string[] {
  return bucket.repos.map((p) => basename(p));
}
