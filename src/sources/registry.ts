import { loadConfig } from '../sync/index.js';
import { ensureGitignore } from '../utils/fs.js';
import { getAdapter, hasAdapter } from './adapters/index.js';
import { isSourceCached, removeSourceRef, resolveSourceContentDir } from './cache.js';
import { readSourceLock, readSourceManifest, writeSourceLock, writeSourceManifest } from './manifest.js';
import { installResolvedSource } from './pipeline.js';
import { parseSourceSpec, sourceKey } from './spec.js';
import { SOURCE_TYPES } from './types.js';
import type {
  InstalledSource,
  ResolvedSource,
  SourceAddOptions,
  SourceInstallOptions,
  SourceLockEntry,
  SourceListOptions,
  SourceRemoveOptions,
  SourceSearchOptions,
  SourceSearchResult,
  SourceSpec,
  SourceUpdateOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

/**
 * Add an external source: resolve + pin it, fetch + translate into the cache, and
 * record it in `llm/rule-sources.json` (manifest) + `llm/rule-sources-lock.json` (lock).
 */
export async function addSource(
  root: string,
  specInput: string,
  options: SourceAddOptions = {},
): Promise<InstalledSource> {
  const log = options.silent ? () => {} : console.log;
  const source = loadConfig(root).source || 'llm';

  const spec = parseSourceSpec(specInput);
  const key = sourceKey(spec);
  const adapter = getAdapter(spec.type);

  log(`Resolving ${key}...`);
  const resolved = await adapter.resolve(spec);

  log(`Installing ${key}@${shortRef(resolved.ref)}...`);
  const entry = await installResolvedSource(root, resolved);

  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);
  manifest.sources[key] = spec;
  lock.sources[key] = entry;
  writeSourceManifest(root, manifest, source);
  writeSourceLock(root, lock, source);

  ensureGitignore(root);

  log(`Added ${key} (${shortRef(entry.ref)})`);
  log(`Run "bluetemberg sync" to apply the new rules.`);

  return installedFromEntry(root, key, entry);
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export function removeSource(root: string, key: string, options: SourceRemoveOptions = {}): void {
  const log = options.silent ? () => {} : console.log;
  const source = loadConfig(root).source || 'llm';

  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);

  if (!(key in manifest.sources) && !(key in lock.sources)) {
    throw new Error(`Source "${key}" is not in the manifest`);
  }

  const entry = lock.sources[key];
  if (entry) removeSourceRef(root, key, entry.ref);

  delete manifest.sources[key];
  delete lock.sources[key];
  writeSourceManifest(root, manifest, source);
  writeSourceLock(root, lock, source);

  log(`Removed ${key}`);
  log(`Run "bluetemberg sync" to update generated files.`);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function listSources(root: string, options: SourceListOptions = {}): InstalledSource[] {
  const log = options.silent ? () => {} : console.log;
  const source = loadConfig(root).source || 'llm';

  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);
  const sources: InstalledSource[] = [];

  for (const key of Object.keys(manifest.sources)) {
    const entry = lock.sources[key];
    const installed = entry
      ? installedFromEntry(root, key, entry)
      : { key, type: manifest.sources[key].type, ref: 'not installed', path: '' };
    sources.push(installed);

    const cached = entry ? isSourceCached(root, key, entry.ref) : false;
    log(`  ${key} (${installed.ref})${cached ? '' : ' [not cached]'}`);
  }

  log(sources.length === 0 ? 'No external sources configured.' : `\n${sources.length} source(s) configured.`);
  return sources;
}

// ---------------------------------------------------------------------------
// install (like npm ci — restore everything from the manifest/lock)
// ---------------------------------------------------------------------------

export async function installSources(
  root: string,
  options: SourceInstallOptions = {},
): Promise<InstalledSource[]> {
  const log = options.silent ? () => {} : console.log;
  const source = loadConfig(root).source || 'llm';

  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);
  const keys = Object.keys(manifest.sources);

  if (keys.length === 0) {
    log('No external sources in manifest.');
    return [];
  }

  log(`Installing ${keys.length} source(s)...\n`);
  const installed: InstalledSource[] = [];

  for (const key of keys) {
    const spec = manifest.sources[key];
    const existing = lock.sources[key];

    if (existing && !options.force && isSourceCached(root, key, existing.ref)) {
      log(`  ${key}@${shortRef(existing.ref)} (cached)`);
      installed.push(installedFromEntry(root, key, existing));
      continue;
    }

    // Locked-but-uncached → reinstall the pinned ref; otherwise resolve fresh.
    const resolved =
      existing && !options.force
        ? resolvedFromLock(spec, key, existing)
        : await getAdapter(spec.type).resolve(spec);
    log(`  ${key}@${shortRef(resolved.ref)} (downloading...)`);
    const entry = await installResolvedSource(root, resolved, { force: options.force });
    lock.sources[key] = entry;
    installed.push(installedFromEntry(root, key, entry));
  }

  const pruned = pruneStaleLock(root, manifest.sources, lock);
  writeSourceLock(root, lock, source);
  ensureGitignore(root);

  const summary = [`\nInstalled ${installed.length} source(s).`];
  if (pruned > 0) summary.push(`Pruned ${pruned} stale lock entr${pruned === 1 ? 'y' : 'ies'}.`);
  log(summary.join(' '));
  return installed;
}

// ---------------------------------------------------------------------------
// update (re-resolve the floating spec; reinstall when the pin changed)
// ---------------------------------------------------------------------------

export async function updateSources(
  root: string,
  key?: string,
  options: SourceUpdateOptions = {},
): Promise<InstalledSource[]> {
  const log = options.silent ? () => {} : console.log;
  const source = loadConfig(root).source || 'llm';

  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);

  if (key !== undefined && !(key in manifest.sources)) {
    throw new Error(`Source "${key}" is not in the manifest`);
  }

  const keys = key ? [key] : Object.keys(manifest.sources);
  if (keys.length === 0) {
    log('No external sources in manifest.');
    return [];
  }

  log(`Updating ${keys.length} source(s)...\n`);
  const results: InstalledSource[] = [];

  for (const k of keys) {
    const spec = manifest.sources[k];
    const previous = lock.sources[k]?.ref;

    log(`  Resolving ${k}...`);
    const resolved = await getAdapter(spec.type).resolve(spec);

    if (previous === resolved.ref && isSourceCached(root, k, resolved.ref)) {
      log(`  ${k}@${shortRef(resolved.ref)} (up to date)`);
      results.push(installedFromEntry(root, k, lock.sources[k]));
      continue;
    }

    const arrow = previous ? ` ${shortRef(previous)} →` : '';
    log(`  ${k}${arrow} ${shortRef(resolved.ref)} (downloading...)`);
    const entry = await installResolvedSource(root, resolved);

    if (previous && previous !== resolved.ref) {
      removeSourceRef(root, k, previous);
    }
    lock.sources[k] = entry;
    results.push(installedFromEntry(root, k, entry));
  }

  if (!key) pruneStaleLock(root, manifest.sources, lock);
  writeSourceLock(root, lock, source);
  ensureGitignore(root);

  log(`\n${results.length} source(s) processed. Run "bluetemberg sync" to apply changes.`);
  return results;
}

// ---------------------------------------------------------------------------
// search (aggregate across backends that support discovery)
// ---------------------------------------------------------------------------

export async function searchSources(
  query: string,
  options: SourceSearchOptions = {},
): Promise<SourceSearchResult[]> {
  const log = options.silent ? () => {} : console.log;
  const types = options.type ? [options.type] : SOURCE_TYPES;
  const limit = options.limit ?? 20;

  log(`Searching for "${query}"...\n`);

  const results: SourceSearchResult[] = [];
  for (const type of types) {
    if (!hasAdapter(type)) continue;
    const adapter = getAdapter(type);
    if (!adapter.search) continue;
    results.push(...(await adapter.search(query, {})));
  }

  const limited = results.slice(0, limit);
  if (limited.length === 0) {
    log('No results. (GitHub sources are not searchable — add them directly with a spec.)');
    return [];
  }

  for (const r of limited) {
    log(`  ${r.spec}`);
    if (r.description) log(`    ${r.description}`);
  }
  log(`\n${limited.length} result(s).`);
  return limited;
}

// ---------------------------------------------------------------------------
// resolveExternalSourceDirs — consumed by sync
// ---------------------------------------------------------------------------

/**
 * Resolve cached external-source content dirs for sync, in manifest order (lowest
 * priority — caller appends after local + extends + packs). Mirrors
 * `resolvePackSourceDirs`: warns (never throws) for sources that are declared but
 * unlocked/uncached, or locked but no longer in the manifest.
 */
export function resolveExternalSourceDirs(
  root: string,
  source = 'llm',
): { dirs: string[]; warnings: string[] } {
  const manifest = readSourceManifest(root, source);
  const lock = readSourceLock(root, source);

  const manifestKeys = Object.keys(manifest.sources);
  const lockKeys = Object.keys(lock.sources);
  if (manifestKeys.length === 0 && lockKeys.length === 0) return { dirs: [], warnings: [] };

  const dirs: string[] = [];
  const warnings: string[] = [];

  for (const key of manifestKeys) {
    const entry = lock.sources[key];
    if (!entry) {
      warnings.push(
        `Source "${key}" is in the manifest but has no lockfile entry. Run "bluetemberg source install".`,
      );
      continue;
    }
    const dir = resolveSourceContentDir(root, key, entry.ref);
    if (!dir) {
      warnings.push(
        `Source "${key}@${shortRef(entry.ref)}" is locked but not cached. Run "bluetemberg source install".`,
      );
      continue;
    }
    dirs.push(dir);
  }

  for (const key of lockKeys) {
    if (!(key in manifest.sources)) {
      warnings.push(
        `Source "${key}" is in the lockfile but not in the manifest. Run "bluetemberg source remove ${key}" or "bluetemberg source install" to clean up.`,
      );
    }
  }

  return { dirs, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installedFromEntry(root: string, key: string, entry: SourceLockEntry): InstalledSource {
  return {
    key,
    type: entry.type,
    ref: entry.ref,
    path: resolveSourceContentDir(root, key, entry.ref) || '',
  };
}

function resolvedFromLock(spec: SourceSpec, key: string, entry: SourceLockEntry): ResolvedSource {
  return {
    spec,
    key,
    ref: entry.ref,
    resolved: entry.resolved,
    integrity: entry.integrity,
    repository: entry.repository,
  };
}

function pruneStaleLock(
  root: string,
  manifestSources: Record<string, SourceSpec>,
  lock: { sources: Record<string, SourceLockEntry> },
): number {
  let pruned = 0;
  for (const key of Object.keys(lock.sources)) {
    if (key in manifestSources) continue;
    removeSourceRef(root, key, lock.sources[key].ref);
    delete lock.sources[key];
    pruned++;
  }
  return pruned;
}

/** Abbreviate a 40-char git SHA to 7 chars; leave other refs (versions, hashes) intact. */
function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}
