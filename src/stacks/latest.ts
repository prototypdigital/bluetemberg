import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { valid } from 'semver';
import { fetchDistTags } from '../registry/client.js';
import { DEFAULT_REGISTRY } from '../registry/constants.js';
import type { Stack } from '../types.js';
import { packageForStack } from './detect.js';

/**
 * The latest released version of each stack, from the npm registry (#294).
 *
 * The registry is the only reliable source of "what is the newest major", so the range lint asks
 * it — but only for the `dist-tags` (a few bytes, not a framework's tens of megabytes of metadata),
 * only on the public registry (stack packages are public frameworks, so the lookup never follows a
 * project's private registry config), and through a per-user cache. The cache is per user, not per
project: "the latest `next`" is the same answer everywhere, and a project-local file would land as
an untracked file in any repo that does not ignore `.bluetemberg/` (a packs repo, say). Offline, or when the
 * registry cannot be reached, a cached answer of any age is used; with none, the stack is reported
 * as unchecked rather than guessed.
 */

/** How long a looked-up version is trusted before the registry is asked again. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A best-effort lookup: a slow registry must not stall a lint for the default 30s. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** Where `latest` lookups are cached: `$XDG_CACHE_HOME/bluetemberg` (default `~/.cache/bluetemberg`). */
export function latestCachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'bluetemberg', 'latest-versions.json');
}

interface CacheEntry {
  latest: string;
  fetchedAt: string;
}

type LatestCache = Record<string, CacheEntry>;

/** Where a stack's latest version came from; `null` when it could not be determined. */
export type LatestSource = 'registry' | 'cache' | 'stale-cache';

export interface LatestLookup {
  stack: Stack;
  /** The npm package the stack maps to (`nextjs` → `next`). */
  package: string;
  latest: string | null;
  source: LatestSource | null;
  /** When the version was fetched from the registry (ISO 8601); `null` when unknown. */
  checkedAt: string | null;
  /** Why the latest version is unknown, or why a stale cache was used. */
  note: string | null;
}

export interface LatestOptions {
  /** Never contact the registry; answer from the cache only. */
  offline?: boolean;
  /** Cache file; defaults to {@link latestCachePath}. */
  cacheFile?: string;
  /** Injected for tests: resolve a package's latest version, or throw. */
  fetchLatest?: (pkg: string) => Promise<string>;
  /** Injected for tests: the current time in ms. */
  now?: () => number;
}

async function fetchLatestFromRegistry(pkg: string, root: string): Promise<string> {
  const tags = await fetchDistTags(pkg, DEFAULT_REGISTRY, root, LOOKUP_TIMEOUT_MS);
  if (!tags.latest || valid(tags.latest) === null) {
    throw new Error(`registry has no valid "latest" dist-tag for "${pkg}"`);
  }
  return tags.latest;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.latest === 'string' && typeof entry.fetchedAt === 'string';
}

/** Read the cache, dropping malformed entries. A missing or corrupt file is an empty cache. */
function readCache(path: string): LatestCache {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, entry]) => isCacheEntry(entry)));
  } catch {
    return {};
  }
}

function writeCache(path: string, cache: LatestCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2) + '\n');
  } catch {
    // An unwritable cache dir still lints; it just asks the registry again next time.
  }
}

function isFresh(entry: CacheEntry, now: number): boolean {
  const fetched = new Date(entry.fetchedAt).getTime();
  return !Number.isNaN(fetched) && now - fetched <= CACHE_MAX_AGE_MS;
}

function fromCache(
  stack: Stack,
  pkg: string,
  entry: CacheEntry,
  source: LatestSource,
  note: string | null,
): LatestLookup {
  return { stack, package: pkg, latest: entry.latest, source, checkedAt: entry.fetchedAt, note };
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
}

/**
 * Resolve the latest released version of each stack: fresh cache → registry → stale cache →
 * unknown. Each distinct package is asked once, concurrently; successful lookups are written back.
 */
export async function resolveLatestVersions(
  root: string,
  stacks: readonly Stack[],
  opts: LatestOptions = {},
): Promise<LatestLookup[]> {
  const cacheFile = opts.cacheFile ?? latestCachePath();
  const now = (opts.now ?? Date.now)();
  const fetchLatest = opts.fetchLatest ?? ((pkg: string) => fetchLatestFromRegistry(pkg, root));
  const cache = readCache(cacheFile);
  let dirty = false;

  const lookup = async (stack: Stack): Promise<LatestLookup> => {
    const pkg = packageForStack(stack);
    const cached = cache[pkg];
    if (cached && isFresh(cached, now)) return fromCache(stack, pkg, cached, 'cache', null);

    let reason = 'offline';
    if (!opts.offline) {
      try {
        const latest = await fetchLatest(pkg);
        const entry = { latest, fetchedAt: new Date(now).toISOString() };
        cache[pkg] = entry;
        dirty = true;
        return fromCache(stack, pkg, entry, 'registry', null);
      } catch (err) {
        reason = errorMessage(err);
      }
    }

    if (cached) return fromCache(stack, pkg, cached, 'stale-cache', `${reason}; using the cached version`);
    return { stack, package: pkg, latest: null, source: null, checkedAt: null, note: reason };
  };

  const results = await Promise.all([...new Set(stacks)].sort().map(lookup));
  if (dirty) writeCache(cacheFile, cache);
  return results;
}
