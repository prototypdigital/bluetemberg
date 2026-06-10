import { githubAdapter } from './github.js';
import { cursorDirectoryConfig, SOURCE_FETCH_TIMEOUT_MS } from '../constants.js';
import { sourceKey } from '../spec.js';
import type {
  RawFetchResult,
  ResolvedSource,
  SourceAdapter,
  SourceSearchResult,
  SourceSpec,
} from '../types.js';

const NOT_CONFIGURED =
  'cursor.directory access is not configured. Set BLUETEMBERG_CURSOR_DIRECTORY_URL and ' +
  "BLUETEMBERG_CURSOR_DIRECTORY_KEY to cursor.directory's public Supabase URL + publishable key " +
  "(visible in any *.supabase.co request in the site's browser network panel).";

/**
 * cursor.directory source. Its rule *content* table is RLS-locked to the anon key,
 * so we read the anon-readable `plugins` table for a plugin's GitHub `repository`,
 * then delegate the actual fetch to the GitHub adapter — giving real content with
 * a reproducible commit-SHA pin. Requires the public Supabase URL + publishable key
 * via env (the site is bot-gated, so these can't be auto-discovered).
 */
async function resolve(spec: SourceSpec): Promise<ResolvedSource> {
  if (spec.type !== 'cursor-directory')
    throw new Error(`cursor-directory adapter received a "${spec.type}" spec`);
  if (spec.slug === '*') {
    throw new Error(
      'cursor-directory: "*" is not supported for `add`. Use `source search` to find plugin slugs.',
    );
  }

  const rows = await queryPlugins(
    `plugins?slug=eq.${encodeURIComponent(spec.slug)}&active=eq.true&select=slug,name,repository&limit=1`,
  );
  if (rows.length === 0) {
    throw new Error(`cursor.directory: plugin "${spec.slug}" not found or not active`);
  }

  const repository = typeof rows[0].repository === 'string' ? rows[0].repository : '';
  const repo = parseGitHubRepo(repository);
  if (!repo) {
    throw new Error(
      `cursor.directory: plugin "${spec.slug}" has no GitHub repository to fetch from (got "${repository}")`,
    );
  }

  // Delegate to GitHub for the immutable SHA pin + tarball URL.
  const gh = await githubAdapter.resolve({
    type: 'github',
    owner: repo.owner,
    repo: repo.repo,
    ref: 'HEAD',
    path: '',
  });

  return {
    spec,
    key: sourceKey(spec),
    ref: gh.ref,
    resolved: gh.resolved,
    integrity: '',
    repository,
  };
}

// The resolved source already points at a GitHub codeload tarball, so the GitHub
// adapter's fetch (download + security-filtered extract) works unchanged.
function fetchSource(resolved: ResolvedSource, tmpDir: string): Promise<RawFetchResult> {
  return githubAdapter.fetch(resolved, tmpDir);
}

async function search(query: string): Promise<SourceSearchResult[]> {
  const safe = encodeURIComponent(query.replace(/[^a-zA-Z0-9 _-]/g, '').trim());
  const rows = await queryPlugins(
    `plugins?active=eq.true&or=(name.ilike.*${safe}*,description.ilike.*${safe}*)&select=slug,name,description&limit=50`,
  );
  return rows
    .filter((r) => typeof r.slug === 'string')
    .map((r) => ({
      type: 'cursor-directory' as const,
      spec: `cursor-directory:${r.slug as string}`,
      name: typeof r.name === 'string' ? r.name : (r.slug as string),
      description: typeof r.description === 'string' ? r.description : undefined,
    }));
}

export const cursorDirectoryAdapter: SourceAdapter = {
  type: 'cursor-directory',
  resolve,
  fetch: fetchSource,
  search,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryPlugins(path: string): Promise<Record<string, unknown>[]> {
  const { url, key } = cursorDirectoryConfig();
  if (!url || !key) throw new Error(NOT_CONFIGURED);

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `cursor.directory: access denied (HTTP ${res.status}). The publishable key may be invalid or rotated.`,
    );
  }
  if (!res.ok) {
    throw new Error(`cursor.directory request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}

/** Extract `{owner, repo}` from a GitHub repository URL (https or scp-style), else null. */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}
