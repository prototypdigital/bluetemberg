import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { maxSatisfying } from 'semver';
import { downloadTarball, verifyIntegrity, DEFAULT_REGISTRY } from './client.js';
import { extractTarball } from '../sources/tarball.js';
import type { NpmPackageMetadata, PackageLockEntry } from '../types.js';

const PACKS_DIR = '.bluetemberg/packs';

/** Root of the pack cache directory. */
export function packsCacheDir(root: string): string {
  return join(root, PACKS_DIR);
}

/**
 * Absolute path to a specific pack version in the cache.
 *
 * The package name and version come from the registry response (`metadata.name`),
 * which is untrusted when a custom/compromised registry is configured. A name like
 * `../../../etc` would otherwise escape the cache and cause extraction — and the
 * `rmSync` cleanup — to operate on arbitrary paths. We enforce containment: the
 * resolved directory must stay inside the pack cache.
 */
export function packVersionDir(root: string, name: string, version: string): string {
  const base = packsCacheDir(root);
  const dir = join(base, name, version);
  const rel = relative(base, dir);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Unsafe pack name/version "${name}@${version}" resolves outside the pack cache — refusing.`,
    );
  }
  return dir;
}

/** Check whether a specific pack version is already extracted in the cache. */
export function isPackCached(root: string, name: string, version: string): boolean {
  return existsSync(packVersionDir(root, name, version));
}

/**
 * Resolve the best matching version for a semver range from registry metadata.
 *
 * @throws If no version satisfies the range.
 */
export function resolveVersion(metadata: NpmPackageMetadata, range: string): string {
  // Handle "latest" tag explicitly.
  if (range === 'latest') {
    const tag = metadata['dist-tags']?.latest;
    if (!tag) {
      throw new Error(`Package "${metadata.name}" has no "latest" dist-tag`);
    }
    return tag;
  }

  // Handle other dist-tags (e.g. "next", "beta").
  if (range in (metadata['dist-tags'] || {})) {
    return metadata['dist-tags'][range];
  }

  const versions = Object.keys(metadata.versions);
  const best = maxSatisfying(versions, range);

  if (!best) {
    throw new Error(
      `No version of "${metadata.name}" satisfies range "${range}" (available: ${versions.slice(-5).join(', ')}${versions.length > 5 ? '…' : ''})`,
    );
  }

  return best;
}

/**
 * Download and extract a specific pack version into the local cache.
 *
 * Steps:
 * 1. Fetch tarball from the resolved URL.
 * 2. Verify integrity hash.
 * 3. Extract into `.bluetemberg/packs/<name>/<version>/`.
 *
 * @returns The lock entry with version, resolved URL, and integrity hash.
 */
export async function installPackVersion(
  root: string,
  metadata: NpmPackageMetadata,
  version: string,
  options: { force?: boolean; registryUrl?: string } = {},
): Promise<PackageLockEntry> {
  const dest = packVersionDir(root, metadata.name, version);

  const versionMeta = metadata.versions[version];
  if (!versionMeta) {
    throw new Error(`Version ${version} not found in metadata for "${metadata.name}"`);
  }

  const tarballUrl = versionMeta.dist.tarball;

  // Validate the tarball host matches the configured registry to prevent a
  // compromised registry response from redirecting downloads to an attacker-controlled host.
  const registryHost = new URL(options.registryUrl ?? DEFAULT_REGISTRY).hostname;
  const tarballHost = new URL(tarballUrl).hostname;
  if (tarballHost !== registryHost) {
    throw new Error(
      `Tarball host "${tarballHost}" does not match registry host "${registryHost}" — refusing to download. ` +
        `If your registry uses an external CDN, configure it to serve tarballs from the same host.`,
    );
  }

  const expectedIntegrity = versionMeta.dist.integrity;

  if (!expectedIntegrity) {
    throw new Error(
      `Package "${metadata.name}@${version}" has no integrity hash in registry metadata. Refusing to install.`,
    );
  }

  // Skip if already cached (unless force).
  if (!options.force && existsSync(dest)) {
    // Validate integrity if we have a marker file.
    const markerPath = join(dest, '.bluetemberg-integrity');
    if (existsSync(markerPath)) {
      const cachedIntegrity = readFileSync(markerPath, 'utf8').trim();
      if (cachedIntegrity === expectedIntegrity) {
        return {
          version,
          resolved: tarballUrl,
          integrity: cachedIntegrity,
        };
      }
    }
  }

  // Clean destination if re-downloading.
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  mkdirSync(dest, { recursive: true });

  // Download tarball to a temp file.
  const tmpFile = join(tmpdir(), `bluetemberg-pack-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`);
  let integrity: string;

  try {
    integrity = await downloadTarball(tarballUrl, tmpFile);

    if (!verifyIntegrity(expectedIntegrity, integrity)) {
      throw new Error(
        `Integrity mismatch for "${metadata.name}@${version}": expected ${expectedIntegrity}, got ${integrity}`,
      );
    }

    // Extract tarball with security filtering (rejects symlinks + path traversal).
    await extractTarball(tmpFile, dest, metadata.name);
  } catch (err) {
    // Clean up partial extraction directory on any failure.
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
    throw err;
  } finally {
    // Always clean up temp file.
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  // Write integrity marker for future cache validation.
  const markerPath = join(dest, '.bluetemberg-integrity');
  writeFileSync(markerPath, integrity + '\n');

  return {
    version,
    resolved: tarballUrl,
    integrity,
  };
}

/**
 * Remove a specific pack version from the local cache.
 */
export function removePackVersion(root: string, name: string, version: string): void {
  const dir = packVersionDir(root, name, version);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }

  // Clean up parent directory if empty.
  const parentDir = join(packsCacheDir(root), name);
  if (existsSync(parentDir)) {
    if (readdirSync(parentDir).length === 0) {
      rmSync(parentDir, { recursive: true, force: true });
    }
  }
}

/**
 * Resolve the source directory inside a cached pack.
 *
 * Checks for `llm/` subdirectory first (conventional layout), then falls back
 * to the pack root — same heuristic as `extends-loader.ts`.
 */
export function resolvePackSourceDir(root: string, name: string, version: string): string | null {
  const base = packVersionDir(root, name, version);
  if (!existsSync(base)) return null;

  const withLlm = join(base, 'llm');
  if (existsSync(withLlm)) return withLlm;

  return base;
}
