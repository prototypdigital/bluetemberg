import { githubAdapter } from './github.js';
import { prpmAdapter } from './prpm.js';
import type { SourceAdapter, SourceType } from '../types.js';

/**
 * Registered source backends. Adapters land incrementally: GitHub and PRPM first,
 * then cursor.directory. {@link getAdapter} reports a clear message for a
 * recognized-but-not-yet-implemented type.
 */
const ADAPTERS: Partial<Record<SourceType, SourceAdapter>> = {
  github: githubAdapter,
  prpm: prpmAdapter,
};

export function getAdapter(type: SourceType): SourceAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`Source type "${type}" is not supported yet.`);
  }
  return adapter;
}

export function hasAdapter(type: SourceType): boolean {
  return type in ADAPTERS;
}
