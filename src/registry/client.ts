import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { NpmPackageMetadata, NpmSearchResult } from '../types.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Hard cap on a downloaded tarball's compressed size. Rule/agent/skill packs are
 * tiny (KBs); this only exists to stop a hostile or runaway remote from filling the
 * disk. Override per-call when a legitimately larger archive is expected.
 */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Fetch full package metadata (all versions) from the npm registry.
 *
 * @throws If the HTTP request fails or the package is not found.
 */
export async function fetchPackageMetadata(name: string, registryUrl?: string): Promise<NpmPackageMetadata> {
  const base = (registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');
  const url = `${base}/${encodePackageName(name)}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 404) {
    throw new Error(`Package "${name}" not found in registry ${base}`);
  }
  if (!res.ok) {
    throw new Error(`Registry request failed: ${res.status} ${res.statusText} (${url})`);
  }

  return (await res.json()) as NpmPackageMetadata;
}

/**
 * Search the npm registry for packages matching a query.
 *
 * By default appends `keywords:bluetemberg-pack` so only rule packs are returned.
 * Pass `raw: true` to search without the keyword filter.
 */
export async function searchPackages(
  query: string,
  options: { registryUrl?: string; limit?: number; raw?: boolean } = {},
): Promise<NpmSearchResult[]> {
  const base = (options.registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');
  const limit = options.limit ?? 20;
  const text = options.raw ? query : `${query} keywords:bluetemberg-pack`;
  const url = `${base}/-/v1/search?text=${encodeURIComponent(text)}&size=${limit}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Registry search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    objects: Array<{
      package: { name: string; version: string; description?: string; keywords?: string[] };
    }>;
  };

  return data.objects.map((o) => ({
    name: o.package.name,
    version: o.package.version,
    description: o.package.description,
    keywords: o.package.keywords,
  }));
}

/**
 * Download a tarball from the given URL to a local file path.
 *
 * @param maxBytes - Abort the download if the response exceeds this many bytes
 *   (defaults to {@link MAX_DOWNLOAD_BYTES}); guards against disk-fill from a
 *   hostile or runaway remote.
 * @returns The SHA-512 integrity string for the downloaded file (`sha512-<base64>`).
 */
export async function downloadTarball(
  url: string,
  destPath: string,
  maxBytes: number = MAX_DOWNLOAD_BYTES,
): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to download tarball: ${res.status} ${res.statusText} (${url})`);
  }

  if (!res.body) {
    throw new Error(`Empty response body when downloading tarball from ${url}`);
  }

  const hash = createHash('sha512');
  const nodeStream = Readable.fromWeb(res.body as WebReadableStream);
  const fileStream = createWriteStream(destPath);

  // Hash each chunk as it passes through, enforce the size cap, then write to disk.
  let received = 0;
  const hashTransform = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      received += chunk.length;
      if (received > maxBytes) {
        cb(new Error(`Tarball from ${url} exceeds the maximum allowed size of ${maxBytes} bytes`));
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  await pipeline(nodeStream, hashTransform, fileStream);

  return `sha512-${hash.digest('base64')}`;
}

/**
 * Verify that a file matches the expected integrity hash.
 *
 * @returns `true` if the hash matches, `false` otherwise.
 */
export function verifyIntegrity(integrity: string, actualIntegrity: string): boolean {
  return integrity === actualIntegrity;
}

/** Encode scoped package names for URL usage: `@scope/name` → `@scope%2fname`. */
function encodePackageName(name: string): string {
  if (name.startsWith('@')) {
    return `@${encodeURIComponent(name.slice(1))}`;
  }
  return encodeURIComponent(name);
}

export { DEFAULT_REGISTRY };
