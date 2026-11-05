import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyIntegrity } from '../registry/client.js';
import { rescanCached, scanAndMark } from '../registry/scan-cache.js';
import type { ScanGateOptions } from '../registry/scan-cache.js';
import { getAdapter } from './adapters/index.js';
import { sourceContentDir } from './cache.js';
import { translateDir } from './translate/index.js';
import type { ResolvedSource, SourceLockEntry, SourceNetOptions } from './types.js';

const INTEGRITY_MARKER = '.bluetemberg-integrity';

/**
 * Download/translate a resolved source into the local cache. The shared spine:
 * `adapter.fetch` populates a temp dir → `translateDir` writes native files into
 * the version-pinned cache dir → the content scan runs → an integrity marker is written.
 * Mirrors the npm pack `installPackVersion` (cache-hit shortcut and re-scan, temp dir,
 * try/catch/finally cleanup).
 *
 * @returns The lockfile entry pinning this source.
 */
export async function installResolvedSource(
  root: string,
  resolved: ResolvedSource,
  options: { force?: boolean; net?: SourceNetOptions } & ScanGateOptions = {},
): Promise<SourceLockEntry> {
  const dest = sourceContentDir(root, resolved.key, resolved.ref);
  const markerPath = join(dest, INTEGRITY_MARKER);
  const label = `${resolved.key}@${resolved.ref}`;

  // Cache hit: dir present and marker matches (or the source has no stable integrity).
  if (!options.force && existsSync(markerPath)) {
    const cached = readFileSync(markerPath, 'utf8').trim();
    if (resolved.integrity === '' || cached === resolved.integrity) {
      // A newer scanner re-vets content an older one (or none) let into the cache.
      rescanCached(dest, label, options);
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

    // Reinstalling from a pinned lockfile entry: when the adapter's integrity is a
    // stable pin (immutable tarballs), the freshly downloaded bytes must match what
    // was locked. A first-time `add` resolves with empty integrity and is skipped
    // (trust-on-first-use); GitHub-backed sources opt out via `verifiesIntegrity`.
    if (
      adapter.verifiesIntegrity &&
      resolved.integrity !== '' &&
      !verifyIntegrity(resolved.integrity, integrity)
    ) {
      throw new Error(
        `Integrity mismatch for "${resolved.key}@${resolved.ref}": lockfile pins ${resolved.integrity} but the ` +
          `download produced ${integrity}. The pinned content changed upstream. Run ` +
          `"bluetemberg source update ${resolved.key}" to re-pin, or "source install --force" to accept it.`,
      );
    }

    const srcRoot = raw.rootSubdir ? join(raw.rawDir, raw.rootSubdir) : raw.rawDir;
    translateDir(srcRoot, dest, { subtypeHint: raw.subtypeHint });
    // External content is the least trusted input the engine syncs: scan it like a pack, before
    // the integrity marker makes it a cache hit. A blocking finding lands in the catch below.
    scanAndMark(dest, label, options);

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
  if (resolved.subtype) entry.subtype = resolved.subtype;
  return entry;
}
