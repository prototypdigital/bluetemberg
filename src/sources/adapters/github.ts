import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadTarball } from '../../registry/client.js';
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
    throw new Error(`GitHub: repo or ref not found — ${spec.owner}/${spec.repo}#${spec.ref}`);
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

async function fetchSource(resolved: ResolvedSource, tmpDir: string): Promise<RawFetchResult> {
  const tmpFile = join(
    tmpdir(),
    `bluetemberg-source-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`,
  );
  try {
    const integrity = await downloadTarball(resolved.resolved, tmpFile);
    await extractTarball(tmpFile, tmpDir, resolved.key, { strip: 1 });
    const rootSubdir = resolved.spec.type === 'github' ? resolved.spec.path : undefined;
    return { rawDir: tmpDir, rootSubdir: rootSubdir || undefined, integrity };
  } finally {
    rmSync(tmpFile, { force: true });
  }
}

export const githubAdapter: SourceAdapter = {
  type: 'github',
  resolve,
  fetch: fetchSource,
};
