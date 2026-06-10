import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { maxSatisfying } from 'semver';
import { downloadTarball } from '../../registry/client.js';
import { extractTarball } from '../tarball.js';
import { safeKey } from '../cache.js';
import { sourceKey } from '../spec.js';
import { PRPM_API_BASE, SOURCE_FETCH_TIMEOUT_MS } from '../constants.js';
import type {
  RawFetchResult,
  ResolvedSource,
  SourceAdapter,
  SourceSearchResult,
  SourceSpec,
  SourceSubtype,
} from '../types.js';

// Packaging files that are never rules/agents/skills.
const NON_CONTENT_FILES = new Set([
  'prpm.json',
  'README.md',
  'readme.md',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
]);

// Matches JSON control characters without embedding literal control chars in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F]', 'g');

/**
 * PRPM source (registry.prpm.dev). Each package is a single rule/agent/skill. We
 * resolve a version, download its tarball, and normalize its (inconsistent) layout
 * into native dirs before the shared translate step runs.
 */
async function resolve(spec: SourceSpec): Promise<ResolvedSource> {
  if (spec.type !== 'prpm') throw new Error(`prpm adapter received a "${spec.type}" spec`);

  const meta = await fetchPrpmJson(`${PRPM_API_BASE}/packages/${encodeURIComponent(spec.name)}`);
  const versions = asObjectArray(meta.versions);
  const version = pickVersion(spec.name, versions, meta.latest_version, spec.range);

  const entry = versions.find((v) => v.version === version);
  const tarballUrl = entry && typeof entry.tarball_url === 'string' ? entry.tarball_url : '';
  if (!tarballUrl) {
    throw new Error(`PRPM: no tarball URL for ${spec.name}@${version}`);
  }

  return {
    spec,
    key: sourceKey(spec),
    ref: version,
    resolved: tarballUrl,
    // PRPM publishes a sha256 content_hash, but our pipeline records sha512; the
    // immutable version string is the real pin, so integrity is trust-on-first-use.
    integrity: '',
    subtype: mapSubtype(meta.subtype),
  };
}

async function fetchSource(resolved: ResolvedSource, tmpDir: string): Promise<RawFetchResult> {
  const tmpFile = join(
    tmpdir(),
    `bluetemberg-source-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`,
  );
  try {
    const integrity = await downloadTarball(resolved.resolved, tmpFile);
    // PRPM tarballs have no wrapper directory (entries sit at the root).
    await extractTarball(tmpFile, tmpDir, resolved.key, { strip: 0 });
    normalizeLayout(tmpDir, prpmSlug(resolved), resolved.subtype);
    return { rawDir: tmpDir, subtypeHint: resolved.subtype, integrity };
  } finally {
    rmSync(tmpFile, { force: true });
  }
}

async function search(query: string): Promise<SourceSearchResult[]> {
  const data = await fetchPrpmJson(`${PRPM_API_BASE}/search?q=${encodeURIComponent(query)}`);
  const packages = asObjectArray(data.packages);
  return packages
    .filter((p) => typeof p.name === 'string')
    .map((p) => ({
      type: 'prpm' as const,
      spec: `prpm:${p.name as string}`,
      name: p.name as string,
      description: typeof p.description === 'string' ? p.description : undefined,
      subtype: mapSubtype(p.subtype),
    }));
}

export const prpmAdapter: SourceAdapter = {
  type: 'prpm',
  // PRPM publishes immutable, content-stable versions, so the tarball hash is a
  // meaningful pin — re-verify it on reinstall (trust-on-first-use thereafter).
  verifiesIntegrity: true,
  resolve,
  fetch: fetchSource,
  search,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch + parse PRPM JSON. PRPM occasionally emits raw control characters inside
 * string values (invalid JSON that strict JSON.parse rejects); since we only read
 * version/tarball/subtype metadata here, stripping control chars to spaces is safe.
 */
async function fetchPrpmJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) throw new Error(`PRPM: not found (${url})`);
  if (!res.ok) throw new Error(`PRPM request failed: ${res.status} ${res.statusText} (${url})`);

  const sanitized = (await res.text()).replace(CONTROL_CHARS, ' ');
  const parsed = JSON.parse(sanitized) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`PRPM: unexpected response shape (${url})`);
  }
  return parsed as Record<string, unknown>;
}

function pickVersion(
  name: string,
  versions: Record<string, unknown>[],
  latestVersion: unknown,
  range: string,
): string {
  const list = versions.map((v) => (typeof v.version === 'string' ? v.version : '')).filter(Boolean);
  if (list.length === 0) throw new Error(`PRPM: package "${name}" has no versions`);

  if (range === 'latest') {
    const latest = extractLatest(latestVersion);
    if (latest && list.includes(latest)) return latest;
    return maxSatisfying(list, '*') ?? list[0];
  }

  const best = maxSatisfying(list, range);
  if (!best) throw new Error(`PRPM: no version of "${name}" satisfies "${range}" (have ${list.join(', ')})`);
  return best;
}

function extractLatest(latestVersion: unknown): string | undefined {
  if (typeof latestVersion === 'string') return latestVersion;
  if (latestVersion && typeof latestVersion === 'object') {
    const v = (latestVersion as Record<string, unknown>).version;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/**
 * Normalize a PRPM package's on-disk layout into native dirs. Structured packages
 * (already containing `skills/`, `rules/`, or `agents/`) are left as-is; a flat
 * package (e.g. a lone `content.mdc`) is moved under the right dir, named after the
 * package, so the shared translate step can route it.
 */
function normalizeLayout(dir: string, slug: string, subtype: SourceSubtype | undefined): void {
  if (['rules', 'agents', 'skills'].some((d) => existsSync(join(dir, d)))) return;

  const files = readdirSync(dir).filter((f) => isFile(join(dir, f)) && !NON_CONTENT_FILES.has(f));
  if (files.length === 0) return;

  if (subtype === 'skill') {
    const skillDir = join(dir, 'skills', slug);
    mkdirSync(skillDir, { recursive: true });
    for (const f of files) renameSync(join(dir, f), join(skillDir, f));
    return;
  }

  const category = subtype === 'agent' ? 'agents' : 'rules';
  const primary = files.find(isRuleLike) ?? files[0];
  const categoryDir = join(dir, category);
  mkdirSync(categoryDir, { recursive: true });
  renameSync(join(dir, primary), join(categoryDir, `${slug}${extname(primary)}`));
}

function prpmSlug(resolved: ResolvedSource): string {
  const name = resolved.spec.type === 'prpm' ? resolved.spec.name : 'package';
  const last = name.split('/').pop() || name;
  return safeKey(last);
}

function mapSubtype(value: unknown): SourceSubtype | undefined {
  if (value === 'rule' || value === 'agent' || value === 'skill') return value;
  return undefined;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
}

function isRuleLike(filename: string): boolean {
  return filename.endsWith('.md') || filename.endsWith('.mdc') || filename.endsWith('.cursorrules');
}

function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}
