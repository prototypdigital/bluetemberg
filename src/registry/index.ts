import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchPackageMetadata, searchPackages } from './client.js';
import { readManifest, writeManifest, readLockfile, writeLockfile } from './manifest.js';
import {
  resolveVersion,
  installPackVersion,
  removePackVersion,
  resolvePackSourceDir,
  isPackCached,
} from './installer.js';
import type {
  InstalledPackage,
  NpmSearchResult,
  RegistryAddOptions,
  RegistryInstallOptions,
  RegistryListOptions,
  RegistryRemoveOptions,
  RegistrySearchOptions,
} from '../types.js';
import { loadConfig } from '../sync/index.js';

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

/**
 * Add a rule pack to the project.
 *
 * 1. Fetches metadata from the npm registry.
 * 2. Resolves the best version matching the requested range.
 * 3. Downloads and extracts the pack to `.bluetemberg/packs/`.
 * 4. Updates `llm/rule-packages.json` (manifest) and `llm/rule-packages-lock.json` (lockfile).
 *
 * @param root - Project root directory.
 * @param packageSpec - Package name, optionally with `@version` (e.g. `my-rules@^1.0.0`).
 */
export async function add(
  root: string,
  packageSpec: string,
  options: RegistryAddOptions = {},
): Promise<InstalledPackage> {
  const log = options.silent ? () => {} : console.log;
  const { name, range } = parsePackageSpec(packageSpec, options.version);

  const config = loadConfig(root);
  const source = config.source || 'llm';

  log(`Resolving ${name}@${range}...`);

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);
  const metadata = await fetchPackageMetadata(name, manifest.registry);
  const version = resolveVersion(metadata, range);

  log(`Installing ${name}@${version}...`);

  const lockEntry = await installPackVersion(root, metadata, version);

  // Update manifest and lockfile.
  manifest.packages[name] = range;
  lock.packages[name] = lockEntry;

  writeManifest(root, manifest, source);
  writeLockfile(root, lock, source);

  ensureGitignore(root);

  const path = resolvePackSourceDir(root, name, version);

  log(`Added ${name}@${version}`);
  log(`Run "bluetemberg sync" to apply the new rules.`);

  return {
    name,
    range,
    version,
    path: path || '',
  };
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

/**
 * Remove a rule pack from the project.
 *
 * Removes from manifest, lockfile, and local cache.
 */
export async function remove(
  root: string,
  packageName: string,
  options: RegistryRemoveOptions = {},
): Promise<void> {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);

  if (!(packageName in manifest.packages)) {
    throw new Error(`Package "${packageName}" is not in the manifest`);
  }

  // Remove from cache if locked.
  const lockEntry = lock.packages[packageName];
  if (lockEntry) {
    removePackVersion(root, packageName, lockEntry.version);
  }

  delete manifest.packages[packageName];
  delete lock.packages[packageName];

  writeManifest(root, manifest, source);
  writeLockfile(root, lock, source);

  log(`Removed ${packageName}`);
  log(`Run "bluetemberg sync" to update generated files.`);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * List all installed rule packs.
 */
export function list(root: string, options: RegistryListOptions = {}): InstalledPackage[] {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);
  const packages: InstalledPackage[] = [];

  for (const [name, range] of Object.entries(manifest.packages)) {
    const lockEntry = lock.packages[name];
    const version = lockEntry?.version || 'not installed';
    const path = lockEntry ? resolvePackSourceDir(root, name, lockEntry.version) || '' : '';
    const cached = lockEntry ? isPackCached(root, name, lockEntry.version) : false;

    packages.push({ name, range, version, path });

    log(`  ${name}@${version} (range: ${range})${cached ? '' : ' [not cached]'}`);
  }

  if (packages.length === 0) {
    log('No rule packs installed.');
  } else {
    log(`\n${packages.length} pack(s) installed.`);
  }

  return packages;
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

/**
 * Install (or restore) all packs from the manifest.
 *
 * Like `npm ci` — reads the manifest, resolves versions via the lockfile when
 * available, downloads missing packs, and updates the lockfile for new entries.
 */
export async function install(
  root: string,
  options: RegistryInstallOptions = {},
): Promise<InstalledPackage[]> {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);
  const installed: InstalledPackage[] = [];

  const names = Object.keys(manifest.packages);
  if (names.length === 0) {
    log('No rule packs in manifest.');
    return [];
  }

  log(`Installing ${names.length} pack(s)...\n`);

  for (const name of names) {
    const range = manifest.packages[name];
    const existingLock = lock.packages[name];

    // Use locked version if it satisfies the range, otherwise re-resolve.
    let version: string;
    let metadata;

    if (existingLock && !options.force) {
      // Check if the cached version is still available.
      if (isPackCached(root, name, existingLock.version)) {
        log(`  ${name}@${existingLock.version} (cached)`);
        installed.push({
          name,
          range,
          version: existingLock.version,
          path: resolvePackSourceDir(root, name, existingLock.version) || '',
        });
        continue;
      }
      // Cached files missing — re-download the locked version.
      metadata = await fetchPackageMetadata(name, manifest.registry);
      version = existingLock.version;
    } else {
      // No lock entry or force mode — resolve from registry.
      metadata = await fetchPackageMetadata(name, manifest.registry);
      version = resolveVersion(metadata, range);
    }

    log(`  ${name}@${version} (downloading...)`);

    const lockEntry = await installPackVersion(root, metadata, version, {
      force: options.force,
    });

    lock.packages[name] = lockEntry;
    installed.push({
      name,
      range,
      version,
      path: resolvePackSourceDir(root, name, version) || '',
    });
  }

  // Prune stale lockfile entries that are no longer in the manifest.
  const staleNames = Object.keys(lock.packages).filter((n) => !(n in manifest.packages));
  for (const name of staleNames) {
    const entry = lock.packages[name];
    removePackVersion(root, name, entry.version);
    delete lock.packages[name];
    log(`  Pruned stale lockfile entry: ${name}@${entry.version}`);
  }

  writeLockfile(root, lock, source);
  ensureGitignore(root);

  log(`\nInstalled ${installed.length} pack(s).`);

  return installed;
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Search the npm registry for bluetemberg rule packs.
 */
export async function search(query: string, options: RegistrySearchOptions = {}): Promise<NpmSearchResult[]> {
  const log = options.silent ? () => {} : console.log;

  log(`Searching for "${query}"...\n`);

  const results = await searchPackages(query, { limit: options.limit });

  if (results.length === 0) {
    log('No packs found. Packs must include "bluetemberg-pack" in their keywords.');
    return [];
  }

  for (const pkg of results) {
    log(`  ${pkg.name}@${pkg.version}`);
    if (pkg.description) log(`    ${pkg.description}`);
  }

  log(`\n${results.length} pack(s) found.`);

  return results;
}

// ---------------------------------------------------------------------------
// resolvePackSourceDirs — used by sync to include packs
// ---------------------------------------------------------------------------

/**
 * Resolve all installed pack source directories for use during sync.
 *
 * Returns directories in manifest order (lower priority than local source and
 * `extends` entries — caller handles priority ordering) along with any warnings
 * about packs that are declared but missing from the lockfile or cache.
 */
export function resolvePackSourceDirs(root: string, source = 'llm'): { dirs: string[]; warnings: string[] } {
  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);

  const manifestNames = Object.keys(manifest.packages);
  const lockNames = Object.keys(lock.packages);
  if (manifestNames.length === 0 && lockNames.length === 0) return { dirs: [], warnings: [] };
  const dirs: string[] = [];
  const warnings: string[] = [];

  for (const name of Object.keys(manifest.packages)) {
    const lockEntry = lock.packages[name];
    if (!lockEntry) {
      warnings.push(
        `Pack "${name}" is in the manifest but has no lockfile entry. Run "bluetemberg install".`,
      );
      continue;
    }

    const dir = resolvePackSourceDir(root, name, lockEntry.version);
    if (!dir) {
      warnings.push(
        `Pack "${name}@${lockEntry.version}" is locked but not cached. Run "bluetemberg install".`,
      );
      continue;
    }

    dirs.push(dir);
  }

  // Warn about stale lockfile entries that are no longer in the manifest.
  for (const name of Object.keys(lock.packages)) {
    if (!(name in manifest.packages)) {
      warnings.push(
        `Pack "${name}" is in the lockfile but not in the manifest. Run "bluetemberg remove ${name}" or "bluetemberg install" to clean up.`,
      );
    }
  }

  return { dirs, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse `name@range` into separate parts. */
function parsePackageSpec(spec: string, explicitVersion?: string): { name: string; range: string } {
  if (explicitVersion) {
    return { name: spec, range: explicitVersion };
  }

  // Handle scoped packages: @scope/name@range
  if (spec.startsWith('@')) {
    const slashIdx = spec.indexOf('/');
    if (slashIdx === -1) {
      return { name: spec, range: 'latest' };
    }
    const afterSlash = spec.slice(slashIdx + 1);
    const atIdx = afterSlash.indexOf('@');
    if (atIdx === -1) {
      return { name: spec, range: 'latest' };
    }
    return {
      name: spec.slice(0, slashIdx + 1 + atIdx),
      range: afterSlash.slice(atIdx + 1),
    };
  }

  // Unscoped: name@range
  const atIdx = spec.indexOf('@');
  if (atIdx === -1) {
    return { name: spec, range: 'latest' };
  }

  return {
    name: spec.slice(0, atIdx),
    range: spec.slice(atIdx + 1),
  };
}

/** Ensure `.bluetemberg/` is in `.gitignore`. */
function ensureGitignore(root: string): void {
  const gitignorePath = `${root}/.gitignore`;
  const marker = '.bluetemberg/';

  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, 'utf8');

  if (content.includes(marker)) return;

  const lines = content.split('\n');
  const newContent = [...lines, '', '# Bluetemberg pack cache', marker, ''].join('\n');
  writeFileSync(gitignorePath, newContent);
}
