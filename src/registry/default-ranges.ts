import { valid } from 'semver';
import { fetchPackageMetadata } from './client.js';
import { DEFAULT_PACK_VERSION, readManifest, writeManifest } from './manifest.js';

/** Looks up the newest published version of a package; `undefined` when it cannot be determined. */
export type LatestVersionResolver = (packageName: string) => Promise<string | undefined>;

export interface PinDefaultRangesResult {
  /** Packs whose range was narrowed from `latest` to `^<version>`. */
  pinned: string[];
  /** Packs left at `latest` because the registry gave no usable answer. */
  unresolved: string[];
}

/** Short on purpose: this is a best-effort nicety that must not stall an offline `init`. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** The registry's `latest` dist-tag for a package, or `undefined` on any failure. */
export function latestPublishedVersion(root: string): LatestVersionResolver {
  return async (packageName) => {
    try {
      const metadata = await fetchPackageMetadata(packageName, undefined, root, LOOKUP_TIMEOUT_MS);
      return metadata['dist-tags']?.latest;
    } catch {
      return undefined;
    }
  };
}

/**
 * Narrows newly written `latest` entries to `^<newest published version>`.
 *
 * `init` and `switch-profile` write `latest` (`DEFAULT_PACK_VERSION`) for the official packs they add. This
 * asks the registry what that is today so the manifest carries a real semver range. Only entries named in
 * `packageNames` that are still `latest` are touched, so a range the user chose is never overwritten.
 * A failed lookup leaves the entry as `latest`, which `install` resolves later.
 */
export async function pinDefaultRanges(
  root: string,
  packageNames: string[],
  resolve: LatestVersionResolver = latestPublishedVersion(root),
): Promise<PinDefaultRangesResult> {
  const manifest = readManifest(root);
  const candidates = packageNames.filter((name) => manifest.packages[name] === DEFAULT_PACK_VERSION);
  if (candidates.length === 0) return { pinned: [], unresolved: [] };

  const versions = await Promise.all(candidates.map((name) => resolve(name)));

  const pinned: string[] = [];
  const unresolved: string[] = [];
  candidates.forEach((name, i) => {
    const version = versions[i];
    if (version === undefined || valid(version) === null) {
      unresolved.push(name);
      return;
    }
    manifest.packages[name] = `^${version}`;
    pinned.push(name);
  });

  if (pinned.length > 0) writeManifest(root, manifest);
  return { pinned, unresolved };
}
