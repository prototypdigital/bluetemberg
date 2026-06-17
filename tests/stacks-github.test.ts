import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  GithubFetchError,
  fetchOrgRepos,
  fetchRepoManifests,
  resolveGithubToken,
} from '../src/stacks/github.js';

/** Build a minimal Response-like object. `body` is serialized for text(); `json` overrides json(). */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  json?: unknown;
  headers?: Record<string, string>;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', body = '', json, headers = {} } = opts;
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok,
    status,
    statusText,
    headers: { get: (k: string) => lower.get(k.toLowerCase()) ?? null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(json ?? body),
  } as unknown as Response;
}

const notFound = () => mockResponse({ ok: false, status: 404, statusText: 'Not Found' });

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveGithubToken', () => {
  const { GITHUB_TOKEN, GH_TOKEN } = process.env;
  afterEach(() => {
    process.env.GITHUB_TOKEN = GITHUB_TOKEN;
    process.env.GH_TOKEN = GH_TOKEN;
  });

  it('prefers GITHUB_TOKEN, falls back to GH_TOKEN, then undefined', () => {
    process.env.GITHUB_TOKEN = 'primary';
    process.env.GH_TOKEN = 'secondary';
    expect(resolveGithubToken()).toBe('primary');

    delete process.env.GITHUB_TOKEN;
    expect(resolveGithubToken()).toBe('secondary');

    delete process.env.GH_TOKEN;
    expect(resolveGithubToken()).toBeUndefined();
  });
});

describe('fetchRepoManifests', () => {
  it('returns the parsed manifest and lockfile (raw media type → text → JSON)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/contents/package.json')) {
        return Promise.resolve(mockResponse({ body: { dependencies: { next: '^15.0.0' } } }));
      }
      if (url.endsWith('/contents/package-lock.json')) {
        return Promise.resolve(
          mockResponse({
            body: { lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.1' } } },
          }),
        );
      }
      return Promise.resolve(notFound());
    });

    const { manifest, lock } = await fetchRepoManifests('acme/app', 'tok');
    expect(manifest.dependencies).toEqual({ next: '^15.0.0' });
    expect((lock?.packages as Record<string, unknown>)['node_modules/next']).toEqual({ version: '15.3.1' });
  });

  it('treats a missing package-lock.json as null (degrades to manifest-coerced)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/contents/package.json')) {
        return Promise.resolve(mockResponse({ body: { dependencies: { payload: '^3.0.0' } } }));
      }
      return Promise.resolve(notFound());
    });

    const { manifest, lock } = await fetchRepoManifests('acme/api', 'tok');
    expect(manifest.dependencies).toEqual({ payload: '^3.0.0' });
    expect(lock).toBeNull();
  });

  it('throws a typed not-found error when package.json is absent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(notFound());
    await expect(fetchRepoManifests('acme/empty', 'tok')).rejects.toBeInstanceOf(GithubFetchError);
    await fetchRepoManifests('acme/empty', 'tok').catch((err) => {
      expect((err as GithubFetchError).reason).toBe('not-found');
    });
  });
});

describe('fetchOrgRepos', () => {
  it('paginates via Link header and excludes forks and archived repos', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('page=2')) {
        return Promise.resolve(mockResponse({ json: [{ full_name: 'acme/b' }] }));
      }
      return Promise.resolve(
        mockResponse({
          json: [
            { full_name: 'acme/a' },
            { full_name: 'acme/forked', fork: true },
            { full_name: 'acme/legacy', archived: true },
          ],
          headers: {
            link: '<https://api.github.com/orgs/acme/repos?type=sources&per_page=100&page=2>; rel="next"',
          },
        }),
      );
    });

    const repos = await fetchOrgRepos('acme', 'tok');
    expect(repos).toEqual(['acme/a', 'acme/b']);
  });

  it('excludes repos whose pushed_at predates the since cutoff', async () => {
    const recentDate = new Date().toISOString();
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        json: [
          { full_name: 'acme/active', pushed_at: recentDate },
          { full_name: 'acme/stale', pushed_at: '2020-01-01T00:00:00Z' },
        ],
      }),
    );
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const repos = await fetchOrgRepos('acme', 'tok', since);
    expect(repos).toEqual(['acme/active']);
  });

  it('includes all repos when since is omitted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        json: [
          { full_name: 'acme/active', pushed_at: new Date().toISOString() },
          { full_name: 'acme/stale', pushed_at: '2020-01-01T00:00:00Z' },
        ],
      }),
    );
    const repos = await fetchOrgRepos('acme', 'tok');
    expect(repos).toEqual(['acme/active', 'acme/stale']);
  });

  it('classifies a 403 with X-RateLimit-Remaining: 0 as rate-limited', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { 'x-ratelimit-remaining': '0' },
        }),
      );
    await fetchOrgRepos('acme', 'tok').then(
      () => expect.fail('should have thrown'),
      (err) => expect((err as GithubFetchError).reason).toBe('rate-limited'),
    );
  });

  it('classifies a 403 with remaining quota as forbidden', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { 'x-ratelimit-remaining': '42' },
        }),
      );
    await fetchOrgRepos('acme', 'tok').then(
      () => expect.fail('should have thrown'),
      (err) => expect((err as GithubFetchError).reason).toBe('forbidden'),
    );
  });
});
