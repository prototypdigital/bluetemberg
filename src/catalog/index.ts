import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamProfile } from '../types.js';

/** Raw catalog published by the packs repo — the single source of truth for pack ids and profiles. */
export const CATALOG_URL =
  'https://raw.githubusercontent.com/prototypdigital/bluetemberg-packs/main/catalog.json';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

export interface CatalogPack {
  name: string;
  version: string;
  description: string;
  profiles: TeamProfile[];
  universal: boolean;
  kind: 'rules' | 'agents' | 'skills' | 'guardrails';
  rules?: string[];
  agents?: string[];
  skills?: string[];
  guardrails?: string[];
  preview: string;
}

export interface Catalog {
  generated: string;
  packs: CatalogPack[];
}

function getCachePath(root: string): string {
  return join(root, '.bluetemberg', 'catalog.json');
}

const VALID_KINDS = new Set<string>(['rules', 'agents', 'skills', 'guardrails']);

/** Narrow parsed JSON to a Catalog, throwing on malformed input. */
function assertCatalog(data: unknown): asserts data is Catalog {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as Record<string, unknown>).generated !== 'string' ||
    !Array.isArray((data as Record<string, unknown>).packs)
  ) {
    throw new Error('Invalid catalog format: missing "generated", or "packs" is not an array');
  }
  for (const pack of (data as Record<string, unknown>).packs as unknown[]) {
    const p = pack as Record<string, unknown>;
    if (
      !pack ||
      typeof pack !== 'object' ||
      typeof p.name !== 'string' ||
      typeof p.version !== 'string' ||
      !VALID_KINDS.has(p.kind as string) ||
      !Array.isArray(p.profiles) ||
      !(p.profiles as unknown[]).every((x) => typeof x === 'string')
    ) {
      throw new Error(
        'Invalid catalog format: pack missing required fields (name, version, kind, profiles) or has invalid kind/profile values',
      );
    }
  }
}

/** The catalog snapshot committed into the package — the offline floor for every command. */
function loadSnapshot(): Catalog {
  const raw = readFileSync(new URL('./catalog.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw) as unknown;
  assertCatalog(data);
  return data;
}

/** Read the project-local catalog cache. Returns null when absent, malformed, or (when bounded) stale. */
function readCache(root: string, maxAgeMs?: number): Catalog | null {
  const cachePath = getCachePath(root);
  if (!existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8')) as unknown;
    assertCatalog(data);
    if (maxAgeMs === undefined) return data;
    const generatedTime = new Date(data.generated).getTime();
    if (Number.isNaN(generatedTime)) return null;
    if (Date.now() - generatedTime > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(root: string, catalog: Catalog): void {
  try {
    const cachePath = getCachePath(root);
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(catalog, null, 2) + '\n');
  } catch {
    // cache write failure is non-fatal — the snapshot remains the floor.
  }
}

/** Fetch the live catalog from the packs repo. Throws on network or format errors. */
export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  assertCatalog(data);
  return data;
}

/**
 * Synchronous, offline catalog load for command paths that must stay deterministic
 * (init wizard, scaffold, sync/marketplace). Resolution order: project cache (any age)
 * → committed snapshot. Never touches the network.
 */
export function loadCatalogSync(root: string): Catalog {
  return readCache(root) ?? loadSnapshot();
}

export interface LoadCatalogResult {
  catalog: Catalog;
  fromCache: boolean;
}

/**
 * Async catalog load that prefers a fresh project cache, falls back to a live fetch
 * (refreshing the cache), and finally a stale cache or the committed snapshot when
 * offline. Used by `preview`.
 */
export async function loadCatalog(root: string, force = false): Promise<LoadCatalogResult> {
  const fresh = force ? null : readCache(root, CACHE_MAX_AGE_MS);
  if (fresh) return { catalog: fresh, fromCache: true };

  try {
    const fetched = await fetchCatalog();
    writeCache(root, fetched);
    return { catalog: fetched, fromCache: false };
  } catch {
    const stale = readCache(root);
    if (stale) return { catalog: stale, fromCache: true };
    return { catalog: loadSnapshot(), fromCache: false };
  }
}

/** Best-effort cache refresh after install/update/add. Fetches the live catalog and rewrites the cache. Never throws. */
export async function refreshCatalogCache(root: string): Promise<boolean> {
  try {
    const fetched = await fetchCatalog();
    writeCache(root, fetched);
    return true;
  } catch {
    return false;
  }
}
