import { relative, resolve } from 'node:path';
import type { SyncResults } from '../types.js';
import { computeCheck, ensureDir, writeOrCheck } from '../utils/fs.js';
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
 * Creates an output directory — unless this is a check run, in which case it is a no-op.
 *
 * `sync --check` is a read-only drift gate: it must report what would change without touching the
 * working tree. Directory creation is the one write that bypasses {@link commitPlannedWrite}, so
 * every adapter that pre-creates an output directory must route it through here rather than
 * calling `ensureDir` directly (ESLint enforces this for `src/sync/**`).
 *
 * In write mode this is only needed for a directory that may end up **empty** —
 * `commitPlannedWrite` already creates the parent of every file it writes. The engine therefore
 * calls it in exactly four places (rule and agent target dirs, which survive an all-filtered
 * version gate, and a plugin's `skills/`/`agents/`, which survive a plugin matching neither);
 * each is covered by a test that fails if it is removed. If you are adding a fifth, check first
 * that a `commitPlannedWrite` into that directory does not already cover you.
 */
export function ensurePlannedDir(sink: Pick<SyncSink, 'checkMode'>, dirPath: string): void {
  if (sink.checkMode) return;
  ensureDir(dirPath);
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
