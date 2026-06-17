/**
 * Minimal GitHub REST client for remote stack scanning (Milestone M6, remote path).
 *
 * Reads a repo's `package.json` + `package-lock.json` over the API WITHOUT cloning, and lists an
 * org's repositories. Uses the platform `fetch` + `AbortSignal.timeout` (same pattern as
 * `catalog/index.ts`) — no HTTP dependency. Read-only.
 *
 * SECURITY: the token is read from the environment by the caller and passed in as an opaque
 * string. It is set ONLY as the `Authorization` header value and is never logged, interpolated
 * into an error message, or included in any URL. Error messages strip the API origin and query
 * string so nothing sensitive reaches the caller's `log`/`progress` sinks.
 */

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const TIMEOUT_MS = 30_000;

export type SkipReason = 'not-found' | 'forbidden' | 'rate-limited' | 'timeout' | 'parse-error' | 'unknown';

/** A typed fetch failure so callers can isolate one repo's error without aborting the scan. */
export class GithubFetchError extends Error {
  constructor(
    readonly reason: SkipReason,
    message: string,
  ) {
    super(message);
    this.name = 'GithubFetchError';
  }
}

/** The token gh/CI use, read from the process environment only. Never read from project files. */
export function resolveGithubToken(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? undefined;
}

function headers(token: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'bluetemberg',
  };
}

/** Strip the API origin from a URL for safe inclusion in error messages (never carries a token). */
function safePath(url: string): string {
  return url.replace(API, '').replace(/\?.*$/, '');
}

function classifyStatus(status: number, rateRemaining: string | null): SkipReason {
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 403) return rateRemaining === '0' ? 'rate-limited' : 'forbidden';
  if (status === 401) return 'forbidden';
  return 'unknown';
}

async function ghFetch(url: string, accept: string, token: string): Promise<Response> {
  try {
    return await fetch(url, { headers: headers(token, accept), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new GithubFetchError('timeout', `Request timed out: ${safePath(url)}`);
    }
    throw new GithubFetchError('unknown', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Fetch and parse one JSON file from a repo via the Contents API. Uses the `raw` media type so the
 * response body is the file's bytes (works for files up to 100 MB — covers large lockfiles — and
 * avoids base64 decoding). `optional` files degrade to `null` on 404 / not-readable / unparseable
 * (e.g. a missing or oversized `package-lock.json` falls back to manifest-coerced detection); a
 * rate-limit always propagates so the scan can record it rather than silently under-reporting.
 */
async function fetchJsonFile(
  url: string,
  token: string,
  optional: boolean,
): Promise<Record<string, unknown> | null> {
  const res = await ghFetch(url, 'application/vnd.github.raw+json', token);
  if (res.status === 404) {
    if (optional) return null;
    throw new GithubFetchError('not-found', `Not found: ${safePath(url)}`);
  }
  if (!res.ok) {
    const reason = classifyStatus(res.status, res.headers.get('x-ratelimit-remaining'));
    if (optional && reason !== 'rate-limited') return null;
    throw new GithubFetchError(reason, `${res.status} ${res.statusText}: ${safePath(url)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (optional) return null;
    throw new GithubFetchError('parse-error', `Invalid JSON: ${safePath(url)}`);
  }
}

export interface RepoManifests {
  manifest: Record<string, unknown>;
  lock: Record<string, unknown> | null;
}

/**
 * Fetch a repo's `package.json` (required) and `package-lock.json` (optional) from its default
 * branch. `path` targets a subdirectory's manifest for non-root projects. Throws
 * {@link GithubFetchError} when the manifest can't be read so the caller can skip just this repo.
 */
export async function fetchRepoManifests(fullName: string, token: string, path = ''): Promise<RepoManifests> {
  const prefix = path ? `${path.replace(/^\/+|\/+$/g, '')}/` : '';
  const base = `${API}/repos/${fullName}/contents/${prefix}`;
  const manifest = await fetchJsonFile(`${base}package.json`, token, false);
  if (!manifest) throw new GithubFetchError('not-found', `No package.json in ${fullName}`);
  const lock = await fetchJsonFile(`${base}package-lock.json`, token, true);
  return { manifest, lock };
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
  return match ? match[1] : null;
}

/**
 * List an organisation's repositories — non-fork (`type=sources`) and non-archived — by their
 * `owner/repo` full names, following `Link` pagination. Pass `since` to exclude repos whose last
 * push predates the cutoff (client-side filter on `pushed_at`; no extra API calls). Throws on a
 * hard failure (bad org, invalid token, rate limit) since none of the repos can be scanned without it.
 */
export async function fetchOrgRepos(org: string, token: string, since?: Date): Promise<string[]> {
  const names: string[] = [];
  let url: string | null = `${API}/orgs/${encodeURIComponent(org)}/repos?type=sources&per_page=100`;

  while (url) {
    const res = await ghFetch(url, 'application/vnd.github+json', token);
    if (!res.ok) {
      const reason = classifyStatus(res.status, res.headers.get('x-ratelimit-remaining'));
      throw new GithubFetchError(
        reason,
        `Failed to list repos for org "${org}": ${res.status} ${res.statusText}`,
      );
    }
    const page = (await res.json()) as Array<{
      full_name?: unknown;
      archived?: unknown;
      fork?: unknown;
      pushed_at?: unknown;
    }>;
    for (const repo of page) {
      if (repo.archived === true || repo.fork === true) continue;
      if (typeof repo.full_name !== 'string') continue;
      if (since && (typeof repo.pushed_at !== 'string' || new Date(repo.pushed_at) < since)) continue;
      names.push(repo.full_name);
    }
    url = nextPageUrl(res.headers.get('link'));
  }
  return names;
}
