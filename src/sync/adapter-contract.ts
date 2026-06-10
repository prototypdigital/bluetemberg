import type { BlueprintConfig, Platform, SyncResults } from '../types.js';

/**
 * Context passed to optional npm adapters (see `bluetemberg.config.json` → `adapters`).
 * Use `commitPlannedWrite` from `bluetemberg/sync/pipeline` for drift-safe writes.
 */
export interface AdapterContext {
  root: string;
  sourceBase: string;
  platforms: readonly Platform[];
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
  config: BlueprintConfig;
  /**
   * When `sync(..., { prune: true })` runs, pass this on the sink to `commitPlannedWrite` (from
   * `bluetemberg/sync/pipeline`) so adapter outputs are tracked and not removed by prune.
   */
  expectedOutputPaths?: Set<string>;
}

export type AdapterRecordError = (message: string) => void;

export type AdapterRunFn = (ctx: AdapterContext, recordError: AdapterRecordError) => void | Promise<void>;
