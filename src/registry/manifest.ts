import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageManifest, PackageLock, PackageLockEntry } from '../types.js';

const MANIFEST_FILE = 'rule-packages.json';
const LOCKFILE_FILE = 'rule-packages-lock.json';

// ---------------------------------------------------------------------------
// Manifest (llm/rule-packages.json)
// ---------------------------------------------------------------------------

export function manifestPath(root: string, source = 'llm'): string {
  return join(root, source, MANIFEST_FILE);
}

export function readManifest(root: string, source = 'llm'): PackageManifest {
  const p = manifestPath(root, source);
  if (!existsSync(p)) {
    return { packages: {} };
  }

  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  return validateManifest(raw, p);
}

export function writeManifest(root: string, manifest: PackageManifest, source = 'llm'): void {
  const p = manifestPath(root, source);
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

function validateManifest(raw: unknown, path: string): PackageManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid manifest at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.registry !== undefined && typeof obj.registry !== 'string') {
    throw new Error(`Invalid manifest at ${path}: "registry" must be a string`);
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
// Lockfile (llm/rule-packages-lock.json)
// ---------------------------------------------------------------------------

export function lockfilePath(root: string, source = 'llm'): string {
  return join(root, source, LOCKFILE_FILE);
}

export function readLockfile(root: string, source = 'llm'): PackageLock {
  const p = lockfilePath(root, source);
  if (!existsSync(p)) {
    return { lockfileVersion: 1, packages: {} };
  }

  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  return validateLockfile(raw, p);
}

export function writeLockfile(root: string, lock: PackageLock, source = 'llm'): void {
  const p = lockfilePath(root, source);
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
