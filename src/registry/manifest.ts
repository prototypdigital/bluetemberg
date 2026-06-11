import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PackageManifest, PackageLock, PackageLockEntry } from '../types.js';

const MANIFEST_FILE = 'packages.json';
const LOCKFILE_FILE = 'packages-lock.json';

/**
 * Manifest/lockfile names used before unification (#119). Read-merged into the
 * unified manifest for backward compatibility; consolidated on disk (and the
 * legacy files removed) by {@link migrateLegacyManifests}.
 */
const LEGACY_MANIFEST_FILES = ['rule-packages.json', 'agent-packages.json', 'skill-packages.json'];
const LEGACY_LOCKFILE_FILES = ['rule-packages-lock.json'];

/** Semver range written for newly added official packs (init wizard, switch-profile). */
export const DEFAULT_PACK_VERSION = '^0.1.0';

// ---------------------------------------------------------------------------
// Manifest (llm/packages.json)
// ---------------------------------------------------------------------------

export function manifestPath(root: string, source = 'llm'): string {
  return join(root, source, MANIFEST_FILE);
}

export function readManifest(root: string, source = 'llm'): PackageManifest {
  const p = manifestPath(root, source);
  const manifest = existsSync(p)
    ? validateManifest(JSON.parse(readFileSync(p, 'utf8')) as unknown, p)
    : { packages: {} as Record<string, string> };

  return mergeLegacyManifests(root, source, manifest);
}

/**
 * Merges any legacy kind-split manifests into the given manifest (in memory).
 * Entries already in the unified manifest win on conflict.
 */
function mergeLegacyManifests(root: string, source: string, manifest: PackageManifest): PackageManifest {
  for (const file of LEGACY_MANIFEST_FILES) {
    const p = join(root, source, file);
    if (!existsSync(p)) continue;

    const legacy = validateManifest(JSON.parse(readFileSync(p, 'utf8')) as unknown, p);
    if (manifest.registry === undefined && legacy.registry !== undefined) {
      manifest.registry = legacy.registry;
    }
    for (const [name, range] of Object.entries(legacy.packages)) {
      if (!(name in manifest.packages)) {
        manifest.packages[name] = range;
      }
    }
  }

  return manifest;
}

/** Whether any pre-unification manifest or lockfile files exist on disk. */
export function hasLegacyManifestFiles(root: string, source = 'llm'): boolean {
  return [...LEGACY_MANIFEST_FILES, ...LEGACY_LOCKFILE_FILES].some((f) => existsSync(join(root, source, f)));
}

/**
 * Consolidates legacy kind-split manifests (`rule-packages.json`,
 * `agent-packages.json`, `skill-packages.json`) and their lockfile into the
 * unified `packages.json` / `packages-lock.json`, then deletes the legacy files.
 *
 * @returns The legacy filenames that were removed (empty when nothing to migrate).
 */
export function migrateLegacyManifests(root: string, source = 'llm'): string[] {
  if (!hasLegacyManifestFiles(root, source)) return [];

  // readManifest/readLockfile already merge legacy content in memory.
  writeManifest(root, readManifest(root, source), source);
  writeLockfile(root, readLockfile(root, source), source);

  const removed: string[] = [];
  for (const file of [...LEGACY_MANIFEST_FILES, ...LEGACY_LOCKFILE_FILES]) {
    const p = join(root, source, file);
    if (!existsSync(p)) continue;
    unlinkSync(p);
    removed.push(file);
  }

  return removed;
}

export function writeManifest(root: string, manifest: PackageManifest, source = 'llm'): void {
  const p = manifestPath(root, source);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

function validateManifest(raw: unknown, path: string): PackageManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid manifest at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.registry !== undefined) {
    if (typeof obj.registry !== 'string') {
      throw new Error(`Invalid manifest at ${path}: "registry" must be a string`);
    }
    try {
      const parsed = new URL(obj.registry);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Invalid manifest at ${path}: "registry" must use http: or https: protocol`);
      }
      if (parsed.protocol === 'http:') {
        console.warn(
          `Warning: registry "${obj.registry}" uses http — metadata and tarballs may be intercepted. Consider using https.`,
        );
      }
    } catch (err) {
      if (err instanceof TypeError) {
        throw new Error(`Invalid manifest at ${path}: "registry" is not a valid URL: ${obj.registry}`);
      }
      throw err;
    }
  }

  if (!obj.packages || typeof obj.packages !== 'object' || Array.isArray(obj.packages)) {
    throw new Error(`Invalid manifest at ${path}: "packages" must be an object`);
  }

  for (const [name, range] of Object.entries(obj.packages as Record<string, unknown>)) {
    if (typeof range !== 'string') {
      throw new Error(`Invalid manifest at ${path}: packages["${name}"] must be a string (semver range)`);
    }
  }

  return {
    registry: obj.registry as string | undefined,
    packages: obj.packages as Record<string, string>,
  };
}

// ---------------------------------------------------------------------------
// Lockfile (llm/packages-lock.json)
// ---------------------------------------------------------------------------

export function lockfilePath(root: string, source = 'llm'): string {
  return join(root, source, LOCKFILE_FILE);
}

export function readLockfile(root: string, source = 'llm'): PackageLock {
  const p = lockfilePath(root, source);
  const lock: PackageLock = existsSync(p)
    ? validateLockfile(JSON.parse(readFileSync(p, 'utf8')) as unknown, p)
    : { lockfileVersion: 1, packages: {} };

  for (const file of LEGACY_LOCKFILE_FILES) {
    const legacyPath = join(root, source, file);
    if (!existsSync(legacyPath)) continue;

    const legacy = validateLockfile(JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown, legacyPath);
    for (const [name, entry] of Object.entries(legacy.packages)) {
      if (!(name in lock.packages)) {
        lock.packages[name] = entry;
      }
    }
  }

  return lock;
}

export function writeLockfile(root: string, lock: PackageLock, source = 'llm'): void {
  const p = lockfilePath(root, source);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n');
}

function validateLockfile(raw: unknown, path: string): PackageLock {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid lockfile at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.lockfileVersion !== 1) {
    throw new Error(
      `Invalid lockfile at ${path}: unsupported lockfileVersion ${String(obj.lockfileVersion)} (expected 1)`,
    );
  }

  if (!obj.packages || typeof obj.packages !== 'object' || Array.isArray(obj.packages)) {
    throw new Error(`Invalid lockfile at ${path}: "packages" must be an object`);
  }

  for (const [name, entry] of Object.entries(obj.packages as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid lockfile at ${path}: packages["${name}"] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.version !== 'string') {
      throw new Error(`Invalid lockfile at ${path}: packages["${name}"].version must be a string`);
    }
    if (typeof e.resolved !== 'string') {
      throw new Error(`Invalid lockfile at ${path}: packages["${name}"].resolved must be a string`);
    }
    if (typeof e.integrity !== 'string') {
      throw new Error(`Invalid lockfile at ${path}: packages["${name}"].integrity must be a string`);
    }
  }

  return {
    lockfileVersion: 1,
    packages: obj.packages as Record<string, PackageLockEntry>,
  };
}

/** Check whether the manifest has any packages declared. */
export function hasPackages(root: string, source = 'llm'): boolean {
  const manifest = readManifest(root, source);
  return Object.keys(manifest.packages).length > 0;
}
