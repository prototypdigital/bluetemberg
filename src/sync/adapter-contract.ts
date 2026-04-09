import type { BlueprintConfig, Platform, SyncResults } from '../types.js';

/**
 * Context passed to optional npm adapters (see `bluetemberg.config.json` → `adapters`).
 * Use `commitPlannedWrite` from `@prototypdigital/bluetemberg/sync/pipeline` for drift-safe writes.
 */
export interface AdapterContext {
  root: string;
  sourceBase: string;
  platforms: readonly Platform[];
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
  config: BlueprintConfig;
}

export type AdapterRecordError = (message: string) => void;

export type AdapterRunFn = (ctx: AdapterContext, recordError: AdapterRecordError) => void | Promise<void>;
