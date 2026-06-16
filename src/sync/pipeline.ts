import { relative, resolve } from 'node:path';
import type { SyncResults } from '../types.js';
import { computeCheck, writeOrCheck } from '../utils/fs.js';
import { renderUnifiedDiff } from './diff.js';

/** Minimal context for applying planned file writes (sync and check mode). */
export interface SyncSink {
  root: string;
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
  /** When set (`sync --check --diff`), a per-file unified diff is logged under each OUT OF SYNC line. */
  diff?: boolean;
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

  if (!sink.checkMode) {
    writeOrCheck(outPath, content, false);
    sink.results.synced++;
    return;
  }

  const result = computeCheck(outPath, content);
  if (!result.outOfSync) return;

  sink.log(`  OUT OF SYNC: ${relative(sink.root, outPath)}`);
  if (sink.diff) {
    for (const line of renderUnifiedDiff(result.existing, result.content)) {
      sink.log(line);
    }
  }
  sink.results.outOfSync++;
}
