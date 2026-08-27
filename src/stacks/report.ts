import { loadCatalogSync } from '../catalog/index.js';
import { loadConfig } from '../sync/index.js';
import { collectDeclaredRanges } from './declared.js';
import { detectStacks } from './detect.js';
import { buildStackRegistry, queryCoverage } from './registry.js';
import type { DetectedStacks, DetectionConfidence } from './match.js';
import type { CoverageGapReason, StackOrigin, StackRegistry } from './registry.js';

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
  /** Why coverage is missing, when `covered` is false; `null` when covered. */
  reason: CoverageGapReason | null;
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
  gaps: Array<{ stack: string; resolvedVersion: string; reason: CoverageGapReason }>;
  warnings: Array<{ stack: string; level: 'low-confidence'; message: string }>;
}

export interface CoverageReport {
  query: { stack: string; version: string | null };
  result: {
    known: boolean;
    covered: boolean;
    matchedRange: string | null;
    /** Why coverage is missing, when `covered` is false; `null` when covered. */
    reason: CoverageGapReason | null;
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
 * Human-readable coverage label. A `*` match is name-level (a catalogued pack targets the stack but
 * declares no version range); say so plainly rather than implying version-precise coverage. A
 * concrete matched range is version-precise, and a gap names why it is uncovered.
 */
function describeCoverage(cov: CoverageSummary): string {
  if (!cov.covered) return cov.reason === 'version-uncovered' ? 'gap: version-uncovered' : 'gap: no coverage';
  if (!cov.matchedRange || cov.matchedRange === '*') return 'covered (name-level)';
  return `covered (${cov.matchedRange})`;
}

/**
 * The project's coverage registry: catalog pack names, the version ranges declared by the guidance
 * actually available here (installed packs, `extends`, external sources, and the project's own
 * source dir), and the stacks detection found. Shared by all three reports so they can never
 * disagree on what is covered.
 */
function projectRegistry(root: string): { registry: StackRegistry; detected: DetectedStacks } {
  const config = loadConfig(root);
  const detected = detectStacks(root, config);
  const catalog = loadCatalogSync(root);
  const declared = collectDeclaredRanges(root, config, catalog);
  return { registry: buildStackRegistry(catalog, detected, declared), detected };
}

/** Build the detect report (pure — no I/O beyond reading the project). Exposed for testing. */
export function buildDetectReport(root: string): DetectReport {
  const { registry, detected } = projectRegistry(root);

  const entries: DetectedReportEntry[] = [...detected.entries()].map(([stack, det]) => {
    const cov = queryCoverage(registry, stack, det.version);
    return {
      stack,
      resolvedVersion: det.version,
      confidence: det.confidence,
      source: det.source,
      coverage: {
        known: cov.known,
        covered: cov.covered,
        matchedRange: cov.matchedRange ?? null,
        reason: cov.reason ?? null,
      },
    };
  });

  const gaps = entries
    .filter((e) => !e.coverage.covered)
    .map((e) => ({
      stack: e.stack,
      resolvedVersion: e.resolvedVersion,
      // A detected stack is always "known" (detection put it there), so the reason must come from
      // the covered ranges — otherwise `no-coverage` could never be reported by this command.
      reason: e.coverage.reason ?? ('no-coverage' as const),
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
  const { registry } = projectRegistry(root);
  const result = queryCoverage(registry, stack, version);
  const entry = registry.get(stack);
  return {
    query: { stack, version: version ?? null },
    result: {
      known: result.known,
      covered: result.covered,
      matchedRange: result.matchedRange ?? null,
      reason: result.reason ?? null,
      coveredRanges: entry?.coveredRanges ?? [],
      origins: result.origins,
    },
  };
}

export interface StackListEntry {
  name: string;
  origins: StackOrigin[];
  /** Version ranges known to be covered (`"*"` = name-level pack coverage). */
  coveredRanges: string[];
  /** Version observed locally, when detection found one. */
  version: string | null;
  /** Whether detection found this stack in the current project. */
  detected: boolean;
}

/**
 * List the live stack registry — the union of catalog-declared stacks and stacks detected in the
 * project — with each one's coverage ranges and detected version. Exposed for testing and the MCP
 * `list_stacks` tool.
 */
export function buildStacksList(root: string): StackListEntry[] {
  const { registry } = projectRegistry(root);
  return [...registry.values()].map((entry) => ({
    name: entry.name,
    origins: [...entry.origins],
    coveredRanges: entry.coveredRanges,
    version: entry.version ?? null,
    detected: entry.origins.has('detected'),
  }));
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
    ? `NOT covered (gap: ${report.result.reason ?? 'no-coverage'})`
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
