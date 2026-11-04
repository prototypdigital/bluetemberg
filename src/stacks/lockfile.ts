import { parsePnpmLock } from './lockfile-pnpm.js';
import { isPlainObject, leadingPackageName } from './lockfile-shared.js';
import { parseYarnLock } from './lockfile-yarn.js';

/**
 * Lockfile readers for stack detection (#291): resolve a direct dependency to the exact version
 * the lockfile pins when `node_modules` is not installed.
 *
 * Every reader answers one question — "which version does this workspace package get for `pkg`?"
 * — through {@link Lockfile.versionOf}, so local detection and the remote `scan-org` path share
 * one implementation per format. A reader never guesses: a link, a workspace package, an alias to
 * a different package, or anything that is not a semver version answers `null`, and the caller
 * falls back to the coerced `package.json` range.
 *
 * Parsing never throws to the caller: {@link parseLockfile} turns a malformed, unrecognised or
 * oversized file into an `error` string for the command's `log` to warn with.
 */

/** Lockfile names, in the order they are tried when one directory holds several. */
export const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

const MANAGER_LOCKFILES: Readonly<Record<string, LockfileName>> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
};

/**
 * The lockfiles to look for beside `manifest`, most trusted first: the one its `packageManager`
 * field names (`pnpm@9.15.0` → `pnpm-lock.yaml`), then {@link LOCKFILE_NAMES} order. Detection
 * reads only the first that exists — locally and in a remote scan alike — so a stale
 * `package-lock.json` left in a pnpm repo is never preferred over the lockfile pnpm maintains.
 */
export function lockfileCandidates(manifest: Record<string, unknown> | null | undefined): LockfileName[] {
  const field = manifest?.packageManager;
  const manager = typeof field === 'string' ? field.split('@')[0] : '';
  const preferred = Object.hasOwn(MANAGER_LOCKFILES, manager) ? MANAGER_LOCKFILES[manager] : undefined;
  if (!preferred) return [...LOCKFILE_NAMES];
  return [preferred, ...LOCKFILE_NAMES.filter((name) => name !== preferred)];
}

/**
 * Lockfiles above this size are not read: detection falls back to the range rather than holding a
 * pathological file in memory. Real lockfiles of large monorepos stay well under it.
 */
export const MAX_LOCKFILE_BYTES = 64 * 1024 * 1024;

/** One package on the resolution chain from the detected package up to the lockfile's directory. */
export interface LockfileImporter {
  /** POSIX path from the lockfile's directory; `''` is the lockfile's own directory. */
  path: string;
  /** That package's own `package.json` range for the queried package, when it declares one. */
  range: string | undefined;
}

/** Data from beside the lockfile that some formats need to map a range to its entry. */
export interface LockfileContext {
  /** The `package.json` beside the lockfile — yarn berry reads its `resolutions`. */
  rootManifest?: Record<string, unknown> | null;
  /** The parsed `.yarnrc.yml` beside a berry lockfile — its `catalog` / `catalogs`. */
  yarnrc?: Record<string, unknown> | null;
}

export interface Lockfile {
  file: LockfileName;
  /**
   * The version `pkg` resolves to for the nearest package on `chain` that declares it (nearest
   * first). `null` when no package on the chain has it, or the entry is not a registry version.
   */
  versionOf(pkg: string, chain: LockfileImporter[]): string | null;
}

export type ParsedLockfile = { lock: Lockfile; error?: undefined } | { lock?: undefined; error: string };

/**
 * One npm lockfile entry's version of `pkg`: `undefined` when the entry has none, null when it is
 * an alias to another package (v2/3 record `name: "preact"`, v1 a `npm:preact@…` version).
 */
function npmEntryVersion(pkg: string, entry: unknown): string | null | undefined {
  if (!isPlainObject(entry) || typeof entry.version !== 'string') return undefined;
  if (typeof entry.name === 'string' && entry.name !== pkg) return null;
  if (!entry.version.startsWith('npm:')) return entry.version;
  const target = entry.version.slice('npm:'.length);
  const name = leadingPackageName(target);
  return name === pkg ? target.slice(name.length + 1) : null;
}

/**
 * `package-lock.json`: lockfileVersion 2/3 (`packages["<path>/node_modules/<pkg>"]`) and 1
 * (`dependencies[<pkg>]`) — the lookup used before #291, plus one change: an alias to another
 * package (`"svelte": "npm:preact@10.19.0"`) answers null instead of preact's version.
 */
export function npmLockfile(lock: Record<string, unknown>): Lockfile {
  return {
    file: 'package-lock.json',
    versionOf(pkg, chain) {
      const packages = isPlainObject(lock.packages) ? lock.packages : {};
      for (const { path } of chain) {
        const key = `${path ? `${path}/` : ''}node_modules/${pkg}`;
        const v3 = Object.hasOwn(packages, key) ? npmEntryVersion(pkg, packages[key]) : undefined;
        if (v3 !== undefined) return v3;
      }
      const deps = isPlainObject(lock.dependencies) ? lock.dependencies : {};
      return (Object.hasOwn(deps, pkg) ? npmEntryVersion(pkg, deps[pkg]) : undefined) ?? null;
    },
  };
}

function parseNpmLock(text: string): Lockfile | null {
  const data: unknown = JSON.parse(text);
  return isPlainObject(data) ? npmLockfile(data) : null;
}

/** Flatten an error message to one line, so a warning stays one line in a terminal and in JSON. */
function oneLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line = raw.replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Why a lockfile of `bytes` is not read, or null when it is within the limit. */
export function oversizeError(bytes: number): string | null {
  if (bytes <= MAX_LOCKFILE_BYTES) return null;
  return `too large to read (${formatMiB(bytes)}, limit ${formatMiB(MAX_LOCKFILE_BYTES)})`;
}

function parseByName(file: LockfileName, text: string, context: LockfileContext): Lockfile | null {
  if (file === 'package-lock.json') return parseNpmLock(text);
  if (file === 'pnpm-lock.yaml') return parsePnpmLock(text);
  return parseYarnLock(text, context);
}

/**
 * Parse one lockfile's text. Never throws: a malformed, unrecognised or oversized file comes back
 * as `error` (one line) for the caller to warn with.
 */
export function parseLockfile(
  file: LockfileName,
  text: string,
  context: LockfileContext = {},
): ParsedLockfile {
  const tooLarge = oversizeError(text.length);
  if (tooLarge) return { error: tooLarge };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    const lock = parseByName(file, body, context);
    return lock ? { lock } : { error: 'unrecognised format' };
  } catch (err) {
    return { error: `could not be parsed (${oneLine(err)})` };
  }
}
