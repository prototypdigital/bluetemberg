import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { maxSatisfying } from 'semver';
import { downloadTarball, verifyIntegrity } from './client.js';
import type { NpmPackageMetadata, PackageLockEntry } from '../types.js';

const PACKS_DIR = '.bluetemberg/packs';

/** Root of the pack cache directory. */
export function packsCacheDir(root: string): string {
  return join(root, PACKS_DIR);
}

/** Absolute path to a specific pack version in the cache. */
export function packVersionDir(root: string, name: string, version: string): string {
  return join(packsCacheDir(root), name, version);
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
 * Validate tarball contents before extraction to prevent path traversal attacks.
 *
 * Lists the archive and checks that every entry, after stripping the top-level
 * `package/` prefix (`--strip-components=1`), resolves within the target directory.
 *
 * @throws If any entry would escape the extraction directory.
 */
function validateTarContents(tmpFile: string, packageName: string): void {
  const listing = execFileSync('tar', ['tzf', tmpFile], { stdio: 'pipe', encoding: 'utf8' });

  for (const entry of listing.split('\n').filter(Boolean)) {
    // Strip the first path component (the `package/` prefix from npm tarballs).
    const slashIdx = entry.indexOf('/');
    const stripped = slashIdx === -1 ? '' : entry.slice(slashIdx + 1);
    if (!stripped) continue; // The top-level directory entry itself — harmless.

    // Reject absolute paths and `..` traversal segments.
    if (isAbsolute(stripped) || stripped.split('/').some((seg) => seg === '..')) {
      throw new Error(
        `Malicious tarball for "${packageName}": entry "${entry}" would extract outside the cache directory`,
      );
    }
  }
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
  options: { force?: boolean } = {},
): Promise<PackageLockEntry> {
  const dest = packVersionDir(root, metadata.name, version);

  const versionMeta = metadata.versions[version];
  if (!versionMeta) {
    throw new Error(`Version ${version} not found in metadata for "${metadata.name}"`);
  }

  const tarballUrl = versionMeta.dist.tarball;
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

    // Validate tarball contents before extraction to prevent path traversal.
    validateTarContents(tmpFile, metadata.name);

    // Extract tarball — npm tarballs have a `package/` prefix.
    execFileSync('tar', ['xzf', tmpFile, '-C', dest, '--strip-components=1'], {
      stdio: 'pipe',
    });
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
