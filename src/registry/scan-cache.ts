import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCANNER_VERSION, formatBlockedScan, scanPackContent } from './scanner.js';
import type { ScanResult } from './scanner.js';

/**
 * Records which scanner version vetted a cached pack or source. Written by the engine next to the
 * integrity marker, refused when a pack ships it (it is in `ENGINE_MARKER_FILES`).
 */
export const SCAN_MARKER = '.bluetemberg-scan';
/** Marker content when the user opted out with `--skip-scan`. */
const SKIPPED = 'skipped';

/** How a command wants the content scan run and its results reported. */
export interface ScanGateOptions {
  /** Skip the content scan (trusted private registries / sources). */
  skipScan?: boolean;
  /** Receives non-blocking findings; library code never prints them itself. */
  onScanFindings?: (result: ScanResult) => void;
  /** Called when content was accepted without a scan (`skipScan`). */
  onScanSkipped?: () => void;
}

/** A scan found blocking patterns: the only failure that may remove cached content. */
export class ScanBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanBlockedError';
  }
}

/** What the marker says about a cached dir. */
export type ScanState = 'current' | 'stale' | 'skipped';

export function scanState(dir: string): ScanState {
  const marker = join(dir, SCAN_MARKER);
  if (!existsSync(marker)) return 'stale';
  const recorded = readFileSync(marker, 'utf8').trim();
  if (recorded === SKIPPED) return 'skipped';
  return recorded === String(SCANNER_VERSION) ? 'current' : 'stale';
}

/**
 * Scan `dir` and record the result. A blocking finding throws (the caller decides what to remove);
 * warnings go to `onScanFindings`. With `skipScan` the dir is marked skipped, so `sync` does not
 * nag about it and the next install without `--skip-scan` scans it.
 */
export function scanAndMark(dir: string, label: string, options: ScanGateOptions): void {
  const marker = join(dir, SCAN_MARKER);
  if (options.skipScan) {
    options.onScanSkipped?.();
    writeFileSync(marker, `${SKIPPED}\n`);
    return;
  }
  const scan = scanPackContent(dir);
  if (scan.blocked) throw new ScanBlockedError(formatBlockedScan(label, scan));
  if (scan.findings.length > 0) options.onScanFindings?.(scan);
  writeFileSync(marker, `${SCANNER_VERSION}\n`);
}

/**
 * Re-scan a cache hit that an older scanner (or none) vetted. Content that a newer rule blocks is
 * removed from the cache before the error is thrown, so `sync` stops using it and reports it as
 * not cached. Any other failure (an unreadable file, a full disk) is thrown with the cache left as
 * it was. With `skipScan` an unvetted hit is marked skipped, so `sync` stops asking for a re-scan.
 */
export function rescanCached(dir: string, label: string, options: ScanGateOptions): void {
  const state = scanState(dir);
  if (state === 'current') return;
  if (options.skipScan) {
    if (state === 'stale') scanAndMark(dir, label, options);
    return;
  }
  try {
    scanAndMark(dir, label, options);
  } catch (err) {
    if (err instanceof ScanBlockedError) rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/** The `sync` warning for a cached dir the current scanner has not vetted, or `null`. */
export function staleScanWarning(dir: string, label: string, installCommand: string): string | null {
  if (scanState(dir) !== 'stale') return null;
  return `"${label}" has not been checked by this engine version's content scan rules. Run "${installCommand}" to re-scan it.`;
}
