import { relative } from 'node:path';
import type { SyncResults } from '../types.js';
import { writeOrCheck } from '../utils/fs.js';

/** Minimal context for applying planned file writes (sync and check mode). */
export interface SyncSink {
  root: string;
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
}

/**
 * Writes or diffs a single generated file. Centralizes counting for synced / outOfSync.
 */
export function commitPlannedWrite(sink: SyncSink, outPath: string, content: string): void {
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
