import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceKey } from './types.js';

const SOURCES_DIR = '.bluetemberg/sources';

/** Root of the external-source cache. */
export function sourcesCacheDir(root: string): string {
  return join(root, SOURCES_DIR);
}

/**
 * Absolute path to a specific source version in the cache.
 *
 * Layout: `.bluetemberg/sources/<safeKey>/<ref>/` containing native `rules/`,
 * `agents/`, `skills/`. The translated output is already native format, so the
 * version dir *is* the source dir (no `llm/` fallback like packs).
 */
export function sourceContentDir(root: string, key: SourceKey, ref: string): string {
  return join(sourcesCacheDir(root), safeKey(key), safeRef(ref));
}

/** Whether a specific source version is already cached. */
export function isSourceCached(root: string, key: SourceKey, ref: string): boolean {
  return existsSync(sourceContentDir(root, key, ref));
}

/** Resolve the cached content dir for a source version, or null when not cached. */
export function resolveSourceContentDir(root: string, key: SourceKey, ref: string): string | null {
  const dir = sourceContentDir(root, key, ref);
  return existsSync(dir) ? dir : null;
}

/** Remove a specific cached source version, pruning the now-empty parent. */
export function removeSourceRef(root: string, key: SourceKey, ref: string): void {
  const dir = sourceContentDir(root, key, ref);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }

  const parent = join(sourcesCacheDir(root), safeKey(key));
  if (existsSync(parent) && readdirSync(parent).length === 0) {
    rmSync(parent, { recursive: true, force: true });
  }
}

/**
 * Sanitize a key/ref into a single safe path segment: keep `[A-Za-z0-9._-]`,
 * collapse every other run (incl. `/` and `:`) to `__`, and reject traversal.
 * Prevents remote-derived identifiers from escaping the cache dir.
 */
export function safeKey(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '__');
  if (cleaned === '' || cleaned === '.' || cleaned === '..' || cleaned.split('.').every((s) => s === '')) {
    throw new Error(`Cannot derive a safe cache path from "${value}"`);
  }
  return cleaned;
}

function safeRef(ref: string): string {
  return safeKey(ref);
}
