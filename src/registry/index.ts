import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureGitignore } from '../utils/fs.js';
import {
  fetchPackageMetadata,
  fetchRegistryKeys,
  verifyRegistrySignature,
  computeFileIntegrity,
  searchPackages,
  DEFAULT_REGISTRY,
} from './client.js';
import {
  readManifest,
  writeManifest,
  readLockfile,
  writeLockfile,
  hasLegacyManifestFiles,
  migrateLegacyManifests,
} from './manifest.js';
import {
  resolveVersion,
  installPackVersion,
  removePackVersion,
  resolvePackSourceDir,
  isPackCached,
  packVersionDir,
} from './installer.js';
import type {
  InstalledPackage,
  NpmSearchResult,
  PackVerifyResult,
  RegistryAddOptions,
  RegistryInstallOptions,
  RegistryListOptions,
  RegistryRemoveOptions,
  RegistrySearchOptions,
  RegistryUpdateOptions,
  RegistryVerifyOptions,
} from '../types.js';
import { loadConfig } from '../sync/index.js';

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

/**
 * Add a pack to the project.
 *
 * 1. Fetches metadata from the npm registry.
 * 2. Resolves the best version matching the requested range.
 * 3. Downloads and extracts the pack to `.bluetemberg/packs/`.
 * 4. Updates `llm/packages.json` (manifest) and `llm/packages-lock.json` (lockfile).
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
  consolidateLegacyManifests(root, source, log);

  log(`Resolving ${name}@${range}...`);

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);
  const metadata = await fetchPackageMetadata(name, manifest.registry);
  const version = resolveVersion(metadata, range);

  log(`Installing ${name}@${version}...`);

  const lockEntry = await installPackVersion(root, metadata, version, {
    registryUrl: manifest.registry,
    skipSignatureVerification: options.skipSignatureVerification,
    allowExternalTarballHost: options.allowExternalTarballHost,
  });

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
 * Remove a pack from the project.
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
  consolidateLegacyManifests(root, source, log);

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
 * List all installed packs.
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
    log('No packs installed.');
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
async function dryRunInstall(
  root: string,
  names: string[],
  manifest: ReturnType<typeof readManifest>,
  lock: ReturnType<typeof readLockfile>,
  options: RegistryInstallOptions,
  log: (msg: string) => void,
): Promise<void> {
  log(`[dry-run] Resolving ${names.length} pack(s)...\n`);
  const dryFailed: Array<{ name: string; error: Error }> = [];
  for (const name of names) {
    const range = manifest.packages[name];
    const existingLock = lock.packages[name];
    try {
      if (existingLock && !options.force && isPackCached(root, name, existingLock.version)) {
        log(`  ${name}@${existingLock.version} (cached ✓)`);
        continue;
      }
      const metadata = await fetchPackageMetadata(name, manifest.registry);
      const version = resolveVersion(metadata, existingLock && !options.force ? existingLock.version : range);
      log(`  ${name}@${version} (would download)`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`  ✗ ${name}: ${error.message}`);
      dryFailed.push({ name, error });
    }
  }
  const staleCount = Object.keys(lock.packages).filter((n) => !(n in manifest.packages)).length;
  if (staleCount > 0)
    log(`\n[dry-run] Would prune ${staleCount} stale lockfile entr${staleCount === 1 ? 'y' : 'ies'}.`);
  log('\nNo files written. Run without --dry-run to apply.');
  if (dryFailed.length > 0) throw new Error(`${dryFailed.length} pack(s) would fail to install.`);
}

export async function install(
  root: string,
  options: RegistryInstallOptions = {},
): Promise<InstalledPackage[]> {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';
  consolidateLegacyManifests(root, source, log);

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);
  const installed: InstalledPackage[] = [];

  const names = Object.keys(manifest.packages);
  if (names.length === 0) {
    log('No packs in manifest.');
    return [];
  }

  if (options.dryRun) {
    await dryRunInstall(root, names, manifest, lock, options, log);
    return [];
  }

  log(`Installing ${names.length} pack(s)...\n`);

  const failed: Array<{ name: string; error: Error }> = [];

  for (const name of names) {
    const range = manifest.packages[name];
    const existingLock = lock.packages[name];

    try {
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
        registryUrl: manifest.registry,
        skipSignatureVerification: options.skipSignatureVerification,
        allowExternalTarballHost: options.allowExternalTarballHost,
      });

      lock.packages[name] = lockEntry;
      installed.push({
        name,
        range,
        version,
        path: resolvePackSourceDir(root, name, version) || '',
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`  ✗ ${name}: ${error.message}`);
      failed.push({ name, error });
    }
  }

  // Prune stale lockfile entries that are no longer in the manifest.
  // Runs regardless of failures so a partial install doesn't accumulate stale entries.
  const staleNames = Object.keys(lock.packages).filter((n) => !(n in manifest.packages));
  for (const name of staleNames) {
    const entry = lock.packages[name];
    removePackVersion(root, name, entry.version);
    delete lock.packages[name];
    log(`  Pruned stale lockfile entry: ${name}@${entry.version}`);
  }

  // Write the lockfile with whatever succeeded — partial install is better than none.
  writeLockfile(root, lock, source);
  ensureGitignore(root);

  const pruned = staleNames.length;
  const summary = [`\nInstalled ${installed.length} pack(s).`];
  if (pruned > 0) summary.push(`Pruned ${pruned} stale lockfile entr${pruned === 1 ? 'y' : 'ies'}.`);
  if (failed.length > 0) summary.push(`${failed.length} pack(s) failed.`);
  log(summary.join(' '));

  if (failed.length > 0) {
    log('\nFailed packs:');
    for (const { name, error } of failed) {
      log(`  ✗ ${name}: ${error.message}`);
    }
    log('\nRun "bluetemberg install" again after resolving the errors above.');
    throw new Error(`${failed.length} pack(s) failed to install.`);
  }

  return installed;
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

/**
 * Update packs to the best version satisfying their current manifest range.
 *
 * For each pack (or just `packageName` if specified):
 * 1. Fetches the latest metadata from the registry.
 * 2. Resolves the best version satisfying the current range (or `"latest"` if
 *    `options.latest` is set).
 * 3. Downloads and installs the new version if it differs from the locked one.
 * 4. Removes the previously cached version when upgraded.
 * 5. Prunes lockfile entries for packages no longer in the manifest (full update only).
 * 6. Updates the lockfile (and manifest when `--latest` widens the range).
 *
 * @param root - Project root directory.
 * @param packageName - Optional single package to update; updates all when omitted.
 */
export async function update(
  root: string,
  packageName?: string,
  options: RegistryUpdateOptions = {},
): Promise<InstalledPackage[]> {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';
  consolidateLegacyManifests(root, source, log);

  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);

  if (packageName !== undefined && !(packageName in manifest.packages)) {
    throw new Error(`Package "${packageName}" is not in the manifest`);
  }

  const names = packageName ? [packageName] : Object.keys(manifest.packages);

  if (names.length === 0) {
    log('No packs in manifest.');
    return [];
  }

  log(`Updating ${names.length} pack(s)...\n`);

  const results: InstalledPackage[] = [];
  const failed: Array<{ name: string; error: Error }> = [];
  let changedCount = 0;

  for (const name of names) {
    const currentRange = manifest.packages[name];
    const range = options.latest ? 'latest' : currentRange;
    const currentLock = lock.packages[name];
    const previousVersion = currentLock?.version;

    try {
      log(`  Resolving ${name}@${range}...`);

      const metadata = await fetchPackageMetadata(name, manifest.registry);
      const version = resolveVersion(metadata, range);

      if (previousVersion === version && isPackCached(root, name, version)) {
        log(`  ${name}@${version} (up to date)`);
        results.push({
          name,
          range: manifest.packages[name],
          version,
          path: resolvePackSourceDir(root, name, version) || '',
        });
        continue;
      }

      const arrow = previousVersion ? ` ${previousVersion} →` : '';
      log(`  ${name}${arrow} ${version} (downloading...)`);

      const lockEntry = await installPackVersion(root, metadata, version, {
        registryUrl: manifest.registry,
        skipSignatureVerification: options.skipSignatureVerification,
        allowExternalTarballHost: options.allowExternalTarballHost,
      });

      lock.packages[name] = lockEntry;

      // Remove the old cached version after a successful install.
      if (previousVersion && previousVersion !== version) {
        try {
          removePackVersion(root, name, previousVersion);
        } catch (cleanupErr) {
          log(
            `  Warning: failed to remove old cached version ${name}@${previousVersion}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          );
        }
      }

      if (options.latest) {
        manifest.packages[name] = 'latest';
      }

      const finalRange = manifest.packages[name];
      results.push({
        name,
        range: finalRange,
        version,
        path: resolvePackSourceDir(root, name, version) || '',
      });

      log(`  Updated ${name}${arrow} ${version}`);
      changedCount++;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`  ✗ ${name}: ${error.message}`);
      failed.push({ name, error });
    }
  }

  // Prune stale lockfile entries (only on full update, not single-package targeting).
  let prunedCount = 0;
  if (!packageName) {
    for (const name of Object.keys(lock.packages)) {
      if (!(name in manifest.packages)) {
        delete lock.packages[name];
        log(`  Pruned stale lockfile entry: ${name}`);
        prunedCount++;
      }
    }
  }

  writeLockfile(root, lock, source);

  if (options.latest) {
    writeManifest(root, manifest, source);
  }

  ensureGitignore(root);

  const summary = [`\n${changedCount} pack(s) updated.`];
  if (prunedCount > 0) summary.push(`${prunedCount} stale lockfile entry(s) pruned.`);
  if (failed.length > 0) summary.push(`${failed.length} pack(s) failed.`);
  if (changedCount > 0 || prunedCount > 0) summary.push(`Run "bluetemberg sync" to apply the changes.`);
  log(summary.join(' '));

  if (failed.length > 0) {
    log('\nFailed packs:');
    for (const { name, error } of failed) {
      log(`  ✗ ${name}: ${error.message}`);
    }
    log('\nRun "bluetemberg update" again after resolving the errors above.');
    throw new Error(`${failed.length} pack(s) failed to update.`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Search the npm registry for bluetemberg packs.
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
// verify — helpers
// ---------------------------------------------------------------------------

function checkPackCachePresence(dest: string, name: string, version: string): PackVerifyResult | null {
  if (!existsSync(dest)) {
    return { name, version, status: 'missing', message: 'Pack directory not found in cache' };
  }
  const markerPath = join(dest, '.bluetemberg-integrity');
  if (!existsSync(markerPath)) {
    return { name, version, status: 'missing', message: 'Integrity marker missing from cache' };
  }
  return null;
}

/**
 * Re-hash the cached tarball when present; for legacy (unsigned) entries without a
 * tarball, fall back to the marker file. IO errors are caught and returned as a
 * result so one corrupt pack cannot abort the whole verify loop.
 *
 * @param isSigned - true when the lockfile has a keyid. Signed entries must have
 *   the tarball — marker fallback is disallowed because it would let an attacker
 *   tamper with extracted files while leaving the marker intact.
 */
function checkPackIntegrity(
  dest: string,
  name: string,
  version: string,
  expectedIntegrity: string,
  isSigned: boolean,
): PackVerifyResult | null {
  const tarballPath = join(dest, '.bluetemberg-pack.tgz');
  const tarballExists = existsSync(tarballPath);

  if (isSigned && !tarballExists) {
    return {
      name,
      version,
      status: 'missing',
      message: 'Preserved tarball not in cache — re-install to restore verifiable artifact',
    };
  }

  try {
    const actualIntegrity = tarballExists
      ? computeFileIntegrity(tarballPath)
      : readFileSync(join(dest, '.bluetemberg-integrity'), 'utf8').trim();

    if (actualIntegrity !== expectedIntegrity) {
      return {
        name,
        version,
        status: 'integrity-mismatch',
        message: `Expected ${expectedIntegrity}, found ${actualIntegrity}`,
      };
    }
  } catch {
    return {
      name,
      version,
      status: 'integrity-mismatch',
      message: 'Failed to read cached artifact for integrity check',
    };
  }

  return null;
}

async function verifyPackSignature(
  name: string,
  version: string,
  integrity: string,
  lockedKeyid: string | undefined,
  registryUrl: string | undefined,
): Promise<PackVerifyResult> {
  const metadata = await fetchPackageMetadata(name, registryUrl);
  const versionMeta = metadata.versions[version];
  if (!versionMeta) {
    return {
      name,
      version,
      status: 'signature-mismatch',
      message: `Version ${version} not found in registry`,
    };
  }

  const allSignatures = versionMeta.dist.signatures ?? [];
  if (allSignatures.length === 0) {
    return { name, version, status: 'unsigned', message: 'No registry signature found' };
  }

  // Pin to the locked keyid so the command enforces reproducibility — any valid
  // signature passes without pinning, making the stored keyid meaningless.
  const signatures = lockedKeyid ? allSignatures.filter((sig) => sig.keyid === lockedKeyid) : allSignatures;

  if (lockedKeyid && signatures.length === 0) {
    return {
      name,
      version,
      status: 'signature-mismatch',
      message: `Registry no longer serves signature for locked keyid ${lockedKeyid}`,
    };
  }

  const keys = await fetchRegistryKeys(registryUrl);
  const { verified } = verifyRegistrySignature(name, version, integrity, signatures, keys);

  if (!verified) {
    return { name, version, status: 'signature-mismatch', message: 'Registry signature does not match' };
  }

  return { name, version, status: 'ok' };
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/**
 * Verify integrity and ECDSA registry signatures of all installed packs.
 *
 * For each pack in the lockfile:
 * 1. Checks that the pack directory and integrity marker exist.
 * 2. Re-hashes the cached tarball (or falls back to the marker) to detect tampering.
 * 3. Fetches fresh registry metadata and verifies the ECDSA signature against the locked keyid.
 *
 * @returns A result per pack with `status: 'ok'` or a failure reason.
 */
export async function verify(root: string, options: RegistryVerifyOptions = {}): Promise<PackVerifyResult[]> {
  const log = options.silent ? () => {} : console.log;
  const config = loadConfig(root);
  const source = config.source || 'llm';
  const manifest = readManifest(root, source);
  const lock = readLockfile(root, source);

  const names = Object.keys(lock.packages);
  if (names.length === 0) {
    log('No packs in lockfile.');
    return [];
  }

  log(`Verifying ${names.length} pack(s)...\n`);

  const results: PackVerifyResult[] = [];
  const registryUrl = manifest.registry ?? DEFAULT_REGISTRY;
  const isDefaultRegistry = registryUrl.replace(/\/$/, '') === DEFAULT_REGISTRY;
  const skipSig = !isDefaultRegistry && options.skipSignatureVerification === true;

  for (const name of names) {
    const { version, integrity, keyid } = lock.packages[name];
    const dest = packVersionDir(root, name, version);

    const presenceResult = checkPackCachePresence(dest, name, version);
    if (presenceResult) {
      results.push(presenceResult);
      log(`  ✗ ${name}@${version} — ${presenceResult.message}`);
      continue;
    }

    const integrityResult = checkPackIntegrity(dest, name, version, integrity, !!keyid);
    if (integrityResult) {
      results.push(integrityResult);
      log(`  ✗ ${name}@${version} — integrity mismatch`);
      continue;
    }

    if (skipSig) {
      results.push({ name, version, status: 'ok' });
      log(`  ✓ ${name}@${version} — ok (signature check skipped)`);
      continue;
    }

    if (!keyid && isDefaultRegistry) {
      results.push({
        name,
        version,
        status: 'unsigned',
        message: 'No keyid in lockfile — re-install to record signature',
      });
      log(`  ✗ ${name}@${version} — unsigned (no keyid in lockfile)`);
      continue;
    }

    try {
      const result = await verifyPackSignature(name, version, integrity, keyid, manifest.registry);
      results.push(result);
      if (result.status === 'ok') {
        log(`  ✓ ${name}@${version} — ok`);
      } else {
        log(`  ✗ ${name}@${version} — ${result.message ?? result.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, version, status: 'signature-mismatch', message: msg });
      log(`  ✗ ${name}@${version} — ${msg}`);
    }
  }

  const failedCount = results.filter((r) => r.status !== 'ok').length;
  log(
    `\n${results.length - failedCount} pack(s) verified ok.${failedCount > 0 ? ` ${failedCount} failed.` : ''}`,
  );

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

  // Sync must stay read-only (it runs with --check in CI), so legacy manifests
  // are merged in memory here and consolidated on disk by the next write command.
  if (hasLegacyManifestFiles(root, source)) {
    warnings.push(
      `Legacy manifest files detected in ${source}/ (data merged in memory) — run "bluetemberg install" to persist them into packages.json and remove the legacy files.`,
    );
  }

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

/** Consolidates legacy kind-split manifests on disk, logging what was migrated. */
function consolidateLegacyManifests(root: string, source: string, log: (msg: string) => void): void {
  const removed = migrateLegacyManifests(root, source);
  if (removed.length === 0) return;

  log(`Migrated legacy manifest(s) (${removed.join(', ')}) into ${source}/packages.json.`);
  log('Commit the updated manifest and the removed legacy files.\n');
}

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
