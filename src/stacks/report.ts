import { loadCatalogSync } from '../catalog/index.js';
import { loadConfig } from '../sync/index.js';
import { detectStacks } from './detect.js';
import { buildStackRegistry, queryCoverage } from './registry.js';
import type { DetectionConfidence } from './match.js';
import type { StackOrigin } from './registry.js';

/**
 * Agent-facing `detect` + `coverage` reports (Stacks epic §4.1–4.2). These are the read surface of
 * the same detection/registry machinery that gates rules at sync, so an agent can call once at
 * session start and self-select version-correct guidance. Both expose a `--json` contract:
 *  - **hard-exclude on no match** — an uncovered (stack,version) appears in `gaps`, never as a silent pass.
 *  - **never silently drop** — low-confidence detection surfaces in `warnings`.
 */

interface CoverageSummary {
  known: boolean;
  covered: boolean;
  matchedRange: string | null;
}

export interface DetectedReportEntry {
  stack: string;
  resolvedVersion: string;
  confidence: DetectionConfidence;
  source: string;
  coverage: CoverageSummary;
}

export interface DetectReport {
  detected: DetectedReportEntry[];
  gaps: Array<{ stack: string; resolvedVersion: string; reason: 'version-uncovered' | 'no-coverage' }>;
  warnings: Array<{ stack: string; level: 'low-confidence'; message: string }>;
}

export interface CoverageReport {
  query: { stack: string; version: string | null };
  result: {
    known: boolean;
    covered: boolean;
    matchedRange: string | null;
    coveredRanges: string[];
    origins: StackOrigin[];
  };
}

interface ReportOptions {
  json?: boolean;
  silent?: boolean;
  /**
   * Sink for user-facing output. Injected by the CLI entry (which owns `console`) so this `src/`
   * module never references `console` directly. Omitted (or `silent`) → output is discarded; use
   * {@link buildDetectReport} / {@link buildCoverageReport} when you only want the data.
   */
  log?: (message: string) => void;
}

function resolveSink(opts: ReportOptions): (message: string) => void {
  if (opts.silent || !opts.log) return () => {};
  return opts.log;
}

const CONFIDENCE_MARK: Record<DetectionConfidence, string> = {
  declared: '✔',
  exact: '✔',
  coerced: '~',
  unknown: '~',
};

function isLowConfidence(confidence: DetectionConfidence): boolean {
  return confidence === 'coerced' || confidence === 'unknown';
}

/**
 * Human-readable coverage label. A `*` match is name-level (a pack targets the stack, any version);
 * say so plainly rather than implying version-precise coverage we do not yet model. A concrete
 * matched range is version-precise.
 */
function describeCoverage(cov: CoverageSummary): string {
  if (!cov.covered) return cov.known ? 'gap: version-uncovered' : 'gap: no coverage';
  if (!cov.matchedRange || cov.matchedRange === '*') return 'covered (name-level)';
  return `covered (${cov.matchedRange})`;
}

/** Build the detect report (pure — no I/O beyond reading the project). Exposed for testing. */
export function buildDetectReport(root: string): DetectReport {
  const config = loadConfig(root);
  const detected = detectStacks(root, config);
  const registry = buildStackRegistry(loadCatalogSync(root), detected);

  const entries: DetectedReportEntry[] = [...detected.entries()].map(([stack, det]) => {
    const cov = queryCoverage(registry, stack, det.version);
    return {
      stack,
      resolvedVersion: det.version,
      confidence: det.confidence,
      source: det.source,
      coverage: { known: cov.known, covered: cov.covered, matchedRange: cov.matchedRange ?? null },
    };
  });

  const gaps = entries
    .filter((e) => !e.coverage.covered)
    .map((e) => ({
      stack: e.stack,
      resolvedVersion: e.resolvedVersion,
      reason: e.coverage.known ? ('version-uncovered' as const) : ('no-coverage' as const),
    }));

  const warnings = entries
    .filter((e) => isLowConfidence(e.confidence))
    .map((e) => ({
      stack: e.stack,
      level: 'low-confidence' as const,
      message: `resolved ${e.resolvedVersion} from ${e.source}; pin a version in bluetemberg.config.json for precision`,
    }));

  return { detected: entries, gaps, warnings };
}

/** Build the coverage report for one `(stack, version?)` query. Exposed for testing. */
export function buildCoverageReport(root: string, stack: string, version?: string): CoverageReport {
  const detected = detectStacks(root, loadConfig(root));
  const registry = buildStackRegistry(loadCatalogSync(root), detected);
  const result = queryCoverage(registry, stack, version);
  const entry = registry.get(stack);
  return {
    query: { stack, version: version ?? null },
    result: {
      known: result.known,
      covered: result.covered,
      matchedRange: result.matchedRange ?? null,
      coveredRanges: entry?.coveredRanges ?? [],
      origins: result.origins,
    },
  };
}

function printDetectHuman(report: DetectReport, log: (msg: string) => void): void {
  if (report.detected.length === 0) {
    log('No stacks detected. Declare them in bluetemberg.config.json "stacks", or install their packages.');
    return;
  }
  log(`Detected stacks (${report.detected.length}):`);
  for (const e of report.detected) {
    const mark = CONFIDENCE_MARK[e.confidence];
    log(
      `  ${mark} ${e.stack} ${e.resolvedVersion}  ${e.confidence} (${e.source})  ${describeCoverage(e.coverage)}`,
    );
  }
  if (report.warnings.length > 0) {
    log('Warnings:');
    for (const w of report.warnings) log(`  ${w.stack} — ${w.level}: ${w.message}`);
  }
}

function printCoverageHuman(report: CoverageReport, log: (msg: string) => void): void {
  const { stack, version } = report.query;
  const label = version ? `${stack}@${version}` : stack;
  if (!report.result.known) {
    log(`${label} — unknown: no installed pack or detected dependency knows this stack.`);
    return;
  }
  const matched = report.result.matchedRange;
  const status = !report.result.covered
    ? 'NOT covered (gap)'
    : !matched || matched === '*'
      ? 'covered (name-level — a pack targets this stack)'
      : `covered (matched ${matched})`;
  log(`${label} — known, ${status}`);
  if (report.result.coveredRanges.length > 0) {
    log(`  covered ranges: ${report.result.coveredRanges.join(', ')}`);
  }
  log(`  origins: ${report.result.origins.join(', ') || '(none)'}`);
}

/** `bluetemberg detect` — report detected stacks, coverage, and gaps (human table or `--json`). */
export function runDetect(root: string, opts: ReportOptions = {}): DetectReport {
  const report = buildDetectReport(root);
  const log = resolveSink(opts);
  if (opts.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    printDetectHuman(report, log);
  }
  return report;
}

/** `bluetemberg coverage <stack>[@version]` — answer "do we have version-correct guidance?". */
export function runCoverage(
  root: string,
  stack: string,
  version?: string,
  opts: ReportOptions = {},
): CoverageReport {
  const report = buildCoverageReport(root, stack, version);
  const log = resolveSink(opts);
  if (opts.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    printCoverageHuman(report, log);
  }
  return report;
}
