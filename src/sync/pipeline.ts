import { relative, resolve } from 'node:path';
import type { SyncResults } from '../types.js';
import { writeOrCheck } from '../utils/fs.js';

/** Minimal context for applying planned file writes (sync and check mode). */
export interface SyncSink {
  root: string;
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
  /** When set (e.g. `sync --prune`), each committed output path is recorded for stale-file removal. */
  expectedOutputPaths?: Set<string>;
}

/**
 * Writes or diffs a single generated file. Centralizes counting for synced / outOfSync.
 *
 * `outPath` should be absolute or rooted under {@link SyncSink.root} (e.g. `join(sink.root, '.cursor', 'x.md')`).
 * A bare relative path resolves against `process.cwd()`, which breaks `--check` and prune tracking.
 */
export function commitPlannedWrite(sink: SyncSink, outPath: string, content: string): void {
  sink.expectedOutputPaths?.add(resolve(outPath));
  const isDiff = writeOrCheck(outPath, content, sink.checkMode);
  if (sink.checkMode && isDiff) {
    sink.log(`  OUT OF SYNC: ${relative(sink.root, outPath)}`);
    sink.results.outOfSync++;
    return;
  }
  if (!sink.checkMode) {
    sink.results.synced++;
  }
}
