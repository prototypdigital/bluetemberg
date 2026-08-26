import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadTarball, TarballDownloadError } from '../../registry/client.js';
import { extractTarball } from '../tarball.js';
import { GITHUB_API_BASE, GITHUB_CODELOAD_BASE, SOURCE_FETCH_TIMEOUT_MS } from '../constants.js';
import { sourceKey } from '../spec.js';
import type {
  RawFetchResult,
  ResolvedSource,
  SourceAdapter,
  SourceNetOptions,
  SourceSpec,
} from '../types.js';

/**
 * GitHub repo source. Resolves a ref → commit SHA (so the lock pins immutably),
 * then downloads the repo tarball from codeload and extracts it through the shared
 * security-filtered `extractTarball`. No new dependency; reuses the registry's
 * `downloadTarball`.
 */
async function resolve(spec: SourceSpec, options: SourceNetOptions = {}): Promise<ResolvedSource> {
  if (spec.type !== 'github') throw new Error(`github adapter received a "${spec.type}" spec`);

  const url = `${GITHUB_API_BASE}/repos/${spec.owner}/${spec.repo}/commits/${encodeURIComponent(spec.ref)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bluetemberg',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS) });
  if (res.status === 404) {
    throw new Error(
      `GitHub: repo or ref not found — ${spec.owner}/${spec.repo}#${spec.ref}` +
        (options.token ? '' : '. Private repos need GITHUB_TOKEN (or GH_TOKEN) in the environment.'),
    );
  }
  if (res.status === 403) {
    throw new Error(
      `GitHub: rate limited or forbidden (${spec.owner}/${spec.repo}). Set a token via SourceNetOptions.token.`,
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText} (${url})`);
  }

  const data = (await res.json()) as { sha?: string };
  if (!data.sha) {
    throw new Error(`GitHub API returned no commit SHA for ${spec.owner}/${spec.repo}#${spec.ref}`);
  }

  return {
    spec,
    key: sourceKey(spec),
    ref: data.sha,
    resolved: `${GITHUB_CODELOAD_BASE}/${spec.owner}/${spec.repo}/tar.gz/${data.sha}`,
    // codeload tarballs publish no hash; the commit SHA is the immutable pin and the
    // computed sha512 (recorded at fetch) only guards cache corruption.
    integrity: '',
  };
}

async function fetchSource(
  resolved: ResolvedSource,
  tmpDir: string,
  options: SourceNetOptions = {},
): Promise<RawFetchResult> {
  const tmpFile = join(
    tmpdir(),
    `bluetemberg-source-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`,
  );
  try {
    const integrity = await downloadArchive(resolved.resolved, tmpFile, options.token);
    await extractTarball(tmpFile, tmpDir, resolved.key, { strip: 1 });
    const rootSubdir = resolved.spec.type === 'github' ? resolved.spec.path : undefined;
    return { rawDir: tmpDir, rootSubdir: rootSubdir || undefined, integrity };
  } finally {
    rmSync(tmpFile, { force: true });
  }
}

/**
 * Download the repo archive, returning its sha512.
 *
 * codeload is always tried first, unauthenticated, even when a token is available.
 * GitHub's two archive endpoints return *different bytes* for the same commit, so
 * choosing between them by token presence would make the recorded integrity depend on
 * the environment rather than on the content — CI (where `GITHUB_TOKEN` is usually set)
 * and a laptop would then write different `integrity` values into the lockfile for the
 * same public source, and each would see a permanent cache miss for the other's.
 *
 * A private repo answers 404 on codeload; only then do we fall back to the REST archive
 * endpoint (`/repos/{owner}/{repo}/tarball/{ref}`), the only documented path that works
 * for private repos. It answers 302 with a short-lived signed codeload URL; `fetch`
 * follows the redirect and drops `Authorization` cross-origin (the signed URL carries
 * its own credentials), so the token never reaches the CDN.
 *
 * Both flavours wrap their contents in exactly one top-level directory, so the caller's
 * `strip: 1` holds either way.
 */
async function downloadArchive(
  codeloadUrl: string,
  tmpFile: string,
  token: string | undefined,
): Promise<string> {
  try {
    return await downloadTarball(codeloadUrl, tmpFile);
  } catch (err) {
    const restUrl = token && isPrivateOrMissing(err) ? restArchiveUrl(codeloadUrl) : undefined;
    if (!restUrl) throw err;

    return downloadTarball(restUrl, tmpFile, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'bluetemberg',
      },
    });
  }
}

/** Whether a failed download could succeed with credentials rather than being broken. */
function isPrivateOrMissing(err: unknown): boolean {
  return err instanceof TarballDownloadError && (err.status === 404 || err.status === 403);
}

/**
 * Rewrite a codeload archive URL as its authenticated REST equivalent, or `null` when the
 * URL is not a codeload one (nothing else may receive the token).
 *
 * Derived from the resolved URL rather than the spec so cursor.directory sources — which
 * delegate resolution here and carry no owner/repo of their own — take the same path.
 */
function restArchiveUrl(url: string): string | null {
  const prefix = `${GITHUB_CODELOAD_BASE}/`;
  if (!url.startsWith(prefix)) return null;

  const match = url.slice(prefix.length).match(/^([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/);
  if (!match) return null;

  const [, owner, repo, ref] = match;
  // A ref may legitimately contain `/` (branch names); every other segment character is
  // encoded so a lockfile entry cannot steer the request to a different API endpoint.
  const refPath = ref.split('/').map(encodeURIComponent).join('/');
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${refPath}`;
}

export const githubAdapter: SourceAdapter = {
  type: 'github',
  resolve,
  fetch: fetchSource,
};
