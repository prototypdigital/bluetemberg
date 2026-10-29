import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { SyncResults } from '../types.js';
import { computeCheck, copyOrCheck, writeOrCheck } from '../utils/fs.js';
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
 * Writes or diffs a single generated file. Centralizes counting for synced / outOfSync, and is the
 * only place sync creates directories: parent dirs are made in write mode only, so `--check` never
 * touches disk. Stages must not `mkdir` ahead of calling this.
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

/**
 * Removes a file bluetemberg owns once nothing is left in it, or in check mode reports it out of
 * sync while it still exists. No-op when the file is already gone. The path is never recorded as an
 * expected output, so prune treats it like any other file the pass did not produce.
 */
export function commitPlannedDelete(sink: SyncSink, outPath: string): void {
  if (!existsSync(outPath)) return;

  if (!sink.checkMode) {
    unlinkSync(outPath);
    sink.results.synced++;
    return;
  }

  sink.log(`  OUT OF SYNC: ${relative(sink.root, outPath)} (should be removed)`);
  if (sink.diff) {
    for (const line of renderUnifiedDiff(readFileSync(outPath, 'utf8'), '')) {
      sink.log(line);
    }
  }
  sink.results.outOfSync++;
}

/**
 * Copies a file byte for byte, keeping its mode (an executable script stays executable), or in
 * check mode reports it out of sync when the bytes differ. For a skill's supporting files —
 * scripts, references, assets — which must arrive exactly as authored and get no banner.
 */
export function commitPlannedCopy(sink: SyncSink, srcPath: string, outPath: string): void {
  sink.expectedOutputPaths?.add(resolve(outPath));

  if (!sink.checkMode) {
    copyOrCheck(srcPath, outPath, false);
    sink.results.synced++;
    return;
  }

  if (!copyOrCheck(srcPath, outPath, true)) return;

  sink.log(`  OUT OF SYNC: ${relative(sink.root, outPath)}`);
  sink.results.outOfSync++;
}
