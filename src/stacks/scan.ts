import { basename } from 'node:path';
import { coerce, rcompare } from 'semver';
import { loadCatalogSync } from '../catalog/index.js';
import { loadConfig } from '../sync/index.js';
import { collectDeclaredRanges } from './declared.js';
import { detectStacks, detectStacksFromManifests } from './detect.js';
import { buildStackRegistry, queryCoverage } from './registry.js';
import type { CoverageGapReason, StackRegistry } from './registry.js';
import type { Catalog } from '../catalog/index.js';
import { GithubFetchError, fetchOrgRepos, fetchRepoManifests, type SkipReason } from './github.js';
import type { DetectedStacks, DetectionConfidence } from './match.js';

/**
 * Org-repo (stack, version) scanner / coverage histogram (Milestone M6).
 *
 * MAINTAINER tooling, not an end-developer command: it answers "which version-eras are worth
 * authoring rules for?" by scanning N repos with the SAME detection that gates rules at sync
 * (reuses {@link detectStacks} / {@link detectStacksFromManifests} — no new detection logic),
 * folding into a `(stack, version) → count` histogram, and ranking uncovered buckets vs coverage.
 *
 * Coverage is version-aware: it reads the `stacks:` ranges declared by the guidance available at
 * the catalog root (installed packs and its own source dir), falling back to the catalog's
 * name-level pack tags only for stacks nothing declares a range for. That is what makes
 * "we ship react rules, but only for 18, and 12 repos moved to 19" expressible.
 *
 * Two sources, one report shape:
 *   - LOCAL: filesystem paths to cloned repos (node_modules → lockfile → coerced; highest confidence).
 *   - REMOTE: `--org`/`--repos` read manifests over the GitHub API without cloning (lockfile → coerced).
 *
 * Read-only. INTERNAL-ONLY: reached via `bin/cli.js` dynamic import and the MCP tool, never
 * re-exported from `src/index.ts`. Keep it off the public package contract (see issue #196).
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
  /** Repo ids (local paths or `owner/repo`) that detected this `(stack, version)`. */
  repos: string[];
  /** Least-confident detection seen across the contributing repos. */
  confidence: DetectionConfidence;
  covered: boolean;
  matchedRange: string | null;
  /** Why this bucket is uncovered, when `covered` is false; `null` when covered. */
  reason: CoverageGapReason | null;
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
  reason: CoverageGapReason;
}

/** A remote repo that could not be read; recorded rather than aborting the whole scan. */
export interface SkippedRepo {
  repo: string;
  reason: SkipReason;
  message: string;
}

export interface ScanReport {
  /** Repo ids that were scanned successfully (local paths + remote `owner/repo`). */
  roots: string[];
  scanned: number;
  /** Repos where detection found zero stacks (still counted in `scanned`). */
  empty: string[];
  /** Remote repos that could not be read (404, forbidden, rate-limited, …). */
  skipped: SkippedRepo[];
  histogram: StackHistogramEntry[];
  /** Uncovered `(stack, version)` buckets ranked by usage — the authoring priority list. */
  gaps: ScanGap[];
  /** Sources of covered ranges that could not be read — every gap below may be a false positive. */
  warnings: string[];
}

export interface ScanOptions {
  json?: boolean;
  silent?: boolean;
  /**
   * Sink for the report output. Injected by the CLI (which owns `console`) so this `src/` module
   * never references `console` directly. Omitted (or `silent`) → discarded.
   */
  log?: (message: string) => void;
  /**
   * Sink for progress lines during a remote scan. The CLI wires this to stderr so it never
   * corrupts `--json` output on stdout. Omitted (or `silent`) → discarded.
   */
  progress?: (message: string) => void;
  /**
   * Root the coverage corpus is read from (typically the maintainer's cwd): its catalog (project
   * cache → committed snapshot) plus the version ranges its available guidance declares. Defaults
   * to `process.cwd()` — never a scanned repo, whose own rules would otherwise count as org-wide
   * coverage and mask real gaps.
   */
  catalogRoot?: string;
  /** Remote: scan every non-fork, non-archived repo in this GitHub org. */
  org?: string;
  /** Remote: scan these specific `owner/repo` repositories. */
  repos?: string[];
  /** GitHub token (resolved from the environment by the caller). Required for any remote scan. */
  token?: string;
  /**
   * Only scan repos pushed to within the last N days. Applies to `--org` listings only (explicit
   * `repos` lists are always scanned regardless). Omit for no cutoff.
   */
  since?: number;
}

/** One scanned repo's detection result, source-agnostic — the unit the histogram folds over. */
interface DetectionUnit {
  id: string;
  detected: DetectedStacks;
}

function resolveSink(silent: boolean | undefined, sink?: (m: string) => void): (m: string) => void {
  if (silent || !sink) return () => {};
  return sink;
}

interface MutableBucket {
  count: number;
  repos: string[];
  confidence: DetectionConfidence;
}

/** Fold detection units into a `stack → version → bucket` map; collect units with no stacks. */
function foldUnits(units: DetectionUnit[]): {
  acc: Map<string, Map<string, MutableBucket>>;
  empty: string[];
} {
  const acc = new Map<string, Map<string, MutableBucket>>();
  const empty: string[] = [];

  for (const { id, detected } of units) {
    if (detected.size === 0) {
      empty.push(id);
      continue;
    }
    for (const [stack, det] of detected) {
      const byVersion = acc.get(stack) ?? new Map<string, MutableBucket>();
      acc.set(stack, byVersion);
      const bucket = byVersion.get(det.version);
      if (!bucket) {
        byVersion.set(det.version, { count: 1, repos: [id], confidence: det.confidence });
        continue;
      }
      bucket.count += 1;
      bucket.repos.push(id);
      bucket.confidence = leastConfident(bucket.confidence, det.confidence);
    }
  }
  return { acc, empty };
}

/**
 * Build the coverage corpus for `root`: its catalog plus the ranges its available guidance declares.
 *
 * Detection of the scanned repos is deliberately NOT registered — the registry is the SUPPLY side
 * and the scanned repos are the DEMAND side; registering them would mark every scanned stack
 * "known" and mask the `no-coverage` reason. Best-effort: an unreadable config or manifest degrades
 * to catalog-only (name-level) coverage with a warning, never an aborted scan.
 */
function coverageRegistry(root: string, catalog: Catalog, warn: (m: string) => void): StackRegistry {
  try {
    return buildStackRegistry(
      catalog,
      undefined,
      collectDeclaredRanges(root, loadConfig(root), catalog, warn),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`coverage sources at ${root} could not be read (${message}) — coverage is catalog-only`);
    return buildStackRegistry(catalog);
  }
}

/** Build the histogram + ranked gap list from folded units (the shared local/remote core). */
function buildReport(units: DetectionUnit[], skipped: SkippedRepo[], catalogRoot: string): ScanReport {
  const { acc, empty } = foldUnits(units);
  const warnings: string[] = [];
  const catalog = loadCatalogSync(catalogRoot);
  const registry = coverageRegistry(catalogRoot, catalog, (m) => warnings.push(m));

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
        reason: cov.reason ?? null,
      });
      if (!cov.covered) {
        gaps.push({ stack, version, count: bucket.count, reason: cov.reason ?? 'no-coverage' });
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

  return {
    roots: units.map((u) => u.id),
    scanned: units.length,
    empty,
    skipped,
    histogram,
    gaps,
    warnings,
  };
}

/**
 * Scan local `roots` and build the `(stack, version)` histogram with catalog coverage and a ranked
 * gap list. Pure + synchronous (reads the repos + catalog, returns data) — exposed for the MCP tool
 * and tests. The async {@link runScanOrg} adds the remote path on top of this same core.
 */
export function buildScanReport(roots: string[], catalogRoot?: string): ScanReport {
  const units = roots.map((root) => ({ id: root, detected: detectStacks(root, loadConfig(root)) }));
  return buildReport(units, [], catalogRoot ?? process.cwd());
}

/** Run async tasks with a bounded concurrency window (no dependency; politeness vs GitHub limits). */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Resolve remote targets (`--repos` ∪ org listing) into detection units, isolating per-repo failures. */
async function gatherRemoteUnits(
  org: string | undefined,
  repos: string[],
  token: string,
  progress: (m: string) => void,
  sinceDate?: Date,
): Promise<{ units: DetectionUnit[]; skipped: SkippedRepo[] }> {
  const targets = [...repos];
  if (org) {
    const sinceNote = sinceDate ? ` pushed since ${sinceDate.toISOString().slice(0, 10)}` : '';
    progress(`Listing repos in org "${org}"${sinceNote}…`);
    targets.push(...(await fetchOrgRepos(org, token, sinceDate)));
  }
  const unique = [...new Set(targets)];
  const skipped: SkippedRepo[] = [];
  let done = 0;
  progress(`Scanning ${unique.length} remote repo(s)…`);

  const units = await mapPool(unique, 6, async (fullName) => {
    try {
      const { manifest, lock } = await fetchRepoManifests(fullName, token);
      progress(`  [${++done}/${unique.length}] ${fullName}`);
      return { id: fullName, detected: detectStacksFromManifests(manifest, lock) } as DetectionUnit;
    } catch (err) {
      const reason: SkipReason = err instanceof GithubFetchError ? err.reason : 'unknown';
      skipped.push({ repo: fullName, reason, message: err instanceof Error ? err.message : String(err) });
      progress(`  [${++done}/${unique.length}] ${fullName} — skipped (${reason})`);
      return null;
    }
  });

  return { units: units.filter((u): u is DetectionUnit => u !== null), skipped };
}

const CONFIDENCE_MARK: Record<DetectionConfidence, string> = {
  declared: '✔',
  exact: '✔',
  coerced: '~',
  unknown: '~',
};

function describeCoverage(bucket: VersionBucket): string {
  if (!bucket.covered) return `GAP (${bucket.reason ?? 'no-coverage'})`;
  if (!bucket.matchedRange || bucket.matchedRange === '*') return 'covered (name-level)';
  return `covered (${bucket.matchedRange})`;
}

function printScanHuman(report: ScanReport, log: (msg: string) => void): void {
  const withStacks = report.scanned - report.empty.length;
  const skippedNote = report.skipped.length > 0 ? `, ${report.skipped.length} skipped` : '';
  log(
    `Scanned ${report.scanned} repo(s): ${withStacks} with stacks, ${report.empty.length} empty${skippedNote}.`,
  );
  // Printed up front: an unreadable coverage source means every gap below may be a false positive.
  for (const w of report.warnings) log(`WARN: ${w}`);

  if (report.histogram.length === 0) {
    log('No stacks detected in any scanned repo.');
  } else {
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
    } else {
      log('');
      log('Coverage gaps (ranked by usage — author these first):');
      report.gaps.forEach((gap, i) => {
        log(`  ${i + 1}. ${gap.stack}@${gap.version}  ×${gap.count}  ${gap.reason}`);
      });
    }
  }

  if (report.skipped.length > 0) {
    log('');
    log(`Skipped ${report.skipped.length} repo(s):`);
    for (const s of report.skipped) log(`  ${s.repo} — ${s.reason}: ${s.message}`);
  }
}

/**
 * `bluetemberg scan-org [paths...] [--org] [--repos]` — histogram stack+version usage across N
 * repos (local and/or remote) vs catalog coverage. Read-only maintainer tooling. A remote scan
 * requires `opts.token`; individual remote repos that fail to read are recorded in `skipped`.
 */
export async function runScanOrg(localRoots: string[], opts: ScanOptions = {}): Promise<ScanReport> {
  const log = resolveSink(opts.silent, opts.log);
  const progress = resolveSink(opts.silent, opts.progress);

  const localUnits: DetectionUnit[] = localRoots.map((root) => ({
    id: root,
    detected: detectStacks(root, loadConfig(root)),
  }));

  let remoteUnits: DetectionUnit[] = [];
  let skipped: SkippedRepo[] = [];
  const wantsRemote = Boolean(opts.org) || (opts.repos?.length ?? 0) > 0;
  if (wantsRemote) {
    if (!opts.token) {
      throw new Error('No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN in your environment.');
    }
    const sinceDate = opts.since ? new Date(Date.now() - opts.since * 24 * 60 * 60 * 1000) : undefined;
    const remote = await gatherRemoteUnits(opts.org, opts.repos ?? [], opts.token, progress, sinceDate);
    remoteUnits = remote.units;
    skipped = remote.skipped;
  }

  const report = buildReport([...localUnits, ...remoteUnits], skipped, opts.catalogRoot ?? process.cwd());
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
