import { githubAdapter } from './github.js';
import { prpmAdapter } from './prpm.js';
import { cursorDirectoryAdapter } from './cursor-directory.js';
import type { SourceAdapter, SourceType } from '../types.js';

/** Registered source backends. {@link getAdapter} reports a clear message for an unknown type. */
const ADAPTERS: Partial<Record<SourceType, SourceAdapter>> = {
  github: githubAdapter,
  prpm: prpmAdapter,
  'cursor-directory': cursorDirectoryAdapter,
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
