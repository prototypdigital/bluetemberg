import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SOURCE_TYPES } from './types.js';
import type { SourceLock, SourceLockEntry, SourceManifest, SourceSpec, SourceType } from './types.js';

const MANIFEST_FILE = 'rule-sources.json';
const LOCKFILE_FILE = 'rule-sources-lock.json';

// ---------------------------------------------------------------------------
// Manifest (llm/rule-sources.json)
// ---------------------------------------------------------------------------

export function sourceManifestPath(root: string, source = 'llm'): string {
  return join(root, source, MANIFEST_FILE);
}

export function readSourceManifest(root: string, source = 'llm'): SourceManifest {
  const p = sourceManifestPath(root, source);
  if (!existsSync(p)) {
    return { sources: {} };
  }

  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  return validateManifest(raw, p);
}

export function writeSourceManifest(root: string, manifest: SourceManifest, source = 'llm'): void {
  const p = sourceManifestPath(root, source);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

function validateManifest(raw: unknown, path: string): SourceManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid source manifest at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;
  if (!obj.sources || typeof obj.sources !== 'object' || Array.isArray(obj.sources)) {
    throw new Error(`Invalid source manifest at ${path}: "sources" must be an object`);
  }

  const sources: Record<string, SourceSpec> = {};
  for (const [key, spec] of Object.entries(obj.sources as Record<string, unknown>)) {
    sources[key] = validateSpec(spec, key, path);
  }

  return { sources };
}

function validateSpec(spec: unknown, key: string, path: string): SourceSpec {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Invalid source manifest at ${path}: sources["${key}"] must be an object`);
  }
  const obj = spec as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string' || !SOURCE_TYPES.includes(type as SourceType)) {
    throw new Error(
      `Invalid source manifest at ${path}: sources["${key}"].type must be one of ${SOURCE_TYPES.join(', ')}`,
    );
  }

  if (type === 'github') {
    assertString(obj.owner, `sources["${key}"].owner`, path);
    assertString(obj.repo, `sources["${key}"].repo`, path);
    assertString(obj.ref, `sources["${key}"].ref`, path);
    assertString(obj.path, `sources["${key}"].path`, path);
    // Guard the trust boundary: a hand-edited manifest must not smuggle traversal
    // into the source root (the spec-string parser enforces the same on `add`).
    if ((obj.path as string).split('/').some((seg) => seg === '..')) {
      throw new Error(
        `Invalid source manifest at ${path}: sources["${key}"].path must not contain ".." segments`,
      );
    }
    return {
      type,
      owner: obj.owner as string,
      repo: obj.repo as string,
      ref: obj.ref as string,
      path: obj.path as string,
    };
  }
  if (type === 'prpm') {
    assertString(obj.name, `sources["${key}"].name`, path);
    assertString(obj.range, `sources["${key}"].range`, path);
    return { type, name: obj.name as string, range: obj.range as string };
  }
  assertString(obj.slug, `sources["${key}"].slug`, path);
  return { type: 'cursor-directory', slug: obj.slug as string };
}

// ---------------------------------------------------------------------------
// Lockfile (llm/rule-sources-lock.json)
// ---------------------------------------------------------------------------

export function sourceLockfilePath(root: string, source = 'llm'): string {
  return join(root, source, LOCKFILE_FILE);
}

export function readSourceLock(root: string, source = 'llm'): SourceLock {
  const p = sourceLockfilePath(root, source);
  if (!existsSync(p)) {
    return { lockfileVersion: 1, sources: {} };
  }

  const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
  return validateLock(raw, p);
}

export function writeSourceLock(root: string, lock: SourceLock, source = 'llm'): void {
  const p = sourceLockfilePath(root, source);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n');
}

function validateLock(raw: unknown, path: string): SourceLock {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid source lockfile at ${path}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;
  if (obj.lockfileVersion !== 1) {
    throw new Error(
      `Invalid source lockfile at ${path}: unsupported lockfileVersion ${String(obj.lockfileVersion)} (expected 1)`,
    );
  }
  if (!obj.sources || typeof obj.sources !== 'object' || Array.isArray(obj.sources)) {
    throw new Error(`Invalid source lockfile at ${path}: "sources" must be an object`);
  }

  for (const [key, entry] of Object.entries(obj.sources as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid source lockfile at ${path}: sources["${key}"] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.type !== 'string' || !SOURCE_TYPES.includes(e.type as SourceType)) {
      throw new Error(
        `Invalid source lockfile at ${path}: sources["${key}"].type must be one of ${SOURCE_TYPES.join(', ')}`,
      );
    }
    assertString(e.ref, `sources["${key}"].ref`, path);
    assertString(e.resolved, `sources["${key}"].resolved`, path);
    assertString(e.integrity, `sources["${key}"].integrity`, path);
  }

  return {
    lockfileVersion: 1,
    sources: obj.sources as Record<string, SourceLockEntry>,
  };
}

/** Whether the manifest declares any external sources. */
export function hasSources(root: string, source = 'llm'): boolean {
  const manifest = readSourceManifest(root, source);
  return Object.keys(manifest.sources).length > 0;
}

function assertString(value: unknown, label: string, path: string): void {
  if (typeof value !== 'string') {
    throw new Error(`Invalid source manifest/lockfile at ${path}: ${label} must be a string`);
  }
}
