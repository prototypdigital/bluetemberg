import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAdapter } from './adapters/index.js';
import { sourceContentDir } from './cache.js';
import { translateDir } from './translate/index.js';
import type { ResolvedSource, SourceLockEntry, SourceNetOptions } from './types.js';

const INTEGRITY_MARKER = '.bluetemberg-integrity';

/**
 * Download/translate a resolved source into the local cache. The shared spine:
 * `adapter.fetch` populates a temp dir → `translateDir` writes native files into
 * the version-pinned cache dir → an integrity marker is written. Mirrors the npm
 * pack `installPackVersion` (cache-hit shortcut, temp dir, try/catch/finally cleanup).
 *
 * @returns The lockfile entry pinning this source.
 */
export async function installResolvedSource(
  root: string,
  resolved: ResolvedSource,
  options: { force?: boolean; net?: SourceNetOptions } = {},
): Promise<SourceLockEntry> {
  const dest = sourceContentDir(root, resolved.key, resolved.ref);
  const markerPath = join(dest, INTEGRITY_MARKER);

  // Cache hit: dir present and marker matches (or the source has no stable integrity).
  if (!options.force && existsSync(markerPath)) {
    const cached = readFileSync(markerPath, 'utf8').trim();
    if (resolved.integrity === '' || cached === resolved.integrity) {
      return lockEntry(resolved, cached);
    }
  }

  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });

  const tmpDir = join(tmpdir(), `bluetemberg-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  let integrity = resolved.integrity;
  try {
    const adapter = getAdapter(resolved.spec.type);
    const raw = await adapter.fetch(resolved, tmpDir, options.net);
    if (raw.integrity) integrity = raw.integrity;

    const srcRoot = raw.rootSubdir ? join(raw.rawDir, raw.rootSubdir) : raw.rawDir;
    translateDir(srcRoot, dest, { subtypeHint: raw.subtypeHint });

    writeFileSync(markerPath, integrity + '\n');
  } catch (err) {
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
    throw err;
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  return lockEntry(resolved, integrity);
}

function lockEntry(resolved: ResolvedSource, integrity: string): SourceLockEntry {
  const entry: SourceLockEntry = {
    type: resolved.spec.type,
    ref: resolved.ref,
    resolved: resolved.resolved,
    integrity,
  };
  if (resolved.repository) entry.repository = resolved.repository;
  return entry;
}
