import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScanReport, runScanOrg } from '../src/stacks/scan.js';

/**
 * M6 scanner tests. The fold is net-new code, so each detection source (node_modules → exact,
 * lockfile → exact, manifest → coerced, config → declared) gets a fixture, plus the cross-repo
 * aggregation, version bucketing, and catalog-ranked gap list.
 */

let workdir: string;

beforeEach(() => {
  workdir = join(tmpdir(), `bt-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workdir, { recursive: true });
});
afterEach(() => rmSync(workdir, { recursive: true, force: true }));

function repo(name: string): string {
  const root = join(workdir, name);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeManifest(root: string, deps: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: deps }));
}

function writeNodeModules(root: string, pkg: string, version: string): void {
  const dir = join(root, 'node_modules', ...pkg.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version }));
}

function writeLock(root: string, pkg: string, version: string): void {
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { [`node_modules/${pkg}`]: { version } } }),
  );
}

/** A catalog (committed under the maintainer's catalogRoot) that covers payload but not nextjs. */
const PAYLOAD_PACK = {
  name: 'bluetemberg-rules-payload',
  version: '0.1.0',
  description: '',
  kind: 'rules',
  universal: false,
  profiles: [],
  stacks: ['payload'],
  rules: ['payload-thing'],
  preview: '',
};

/** A catalog pack whose content is version-bounded — the version-precise coverage case. */
const REACT_PACK = {
  name: 'bluetemberg-rules-react',
  version: '0.1.0',
  description: '',
  kind: 'rules',
  universal: false,
  profiles: [],
  stacks: ['react'],
  rules: ['effects-r18'],
  preview: '',
};

/** Write a rule into the catalog root's own source dir, optionally with a `stacks:` constraint. */
function writeRule(root: string, name: string, stacks?: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  const frontmatter = stacks
    ? `---\ndescription: r\nstacks:\n  ${stacks}\n---\n`
    : '---\ndescription: r\n---\n';
  writeFileSync(join(root, 'llm', 'rules', `${name}.md`), `${frontmatter}\nbody\n`);
}

function writeCatalog(root: string, packs: unknown[]): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-06-15T00:00:00.000Z', packs }),
  );
}

describe('buildScanReport — detection sources', () => {
  it('resolves an exact version from node_modules', () => {
    const a = repo('a');
    writeManifest(a, { next: '^15.0.0' });
    writeNodeModules(a, 'next', '15.3.1');

    const report = buildScanReport([a], workdir);
    const nextjs = report.histogram.find((h) => h.stack === 'nextjs');
    expect(nextjs?.versions[0]).toMatchObject({ version: '15.3.1', count: 1, confidence: 'exact' });
  });

  it('resolves an exact version from a lockfile when node_modules is absent (shallow clone)', () => {
    const a = repo('a');
    writeManifest(a, { next: '^14.0.0' });
    writeLock(a, 'next', '14.2.0');

    const report = buildScanReport([a], workdir);
    const nextjs = report.histogram.find((h) => h.stack === 'nextjs');
    expect(nextjs?.versions[0]).toMatchObject({ version: '14.2.0', confidence: 'exact' });
  });

  it('falls back to a coerced version from the manifest range', () => {
    const a = repo('a');
    writeManifest(a, { payload: '^3.4.0' });

    const report = buildScanReport([a], workdir);
    const payload = report.histogram.find((h) => h.stack === 'payload');
    expect(payload?.versions[0]).toMatchObject({ version: '3.4.0', confidence: 'coerced' });
  });
});

describe('buildScanReport — aggregation + gaps', () => {
  it('aggregates the same (stack, version) across repos into one bucket with a combined count', () => {
    const a = repo('a');
    const b = repo('b');
    writeNodeModules(a, 'next', '15.3.1');
    writeNodeModules(b, 'next', '15.3.1');
    writeManifest(a, { next: '15' });
    writeManifest(b, { next: '15' });

    const report = buildScanReport([a, b], workdir);
    const nextjs = report.histogram.find((h) => h.stack === 'nextjs');
    expect(nextjs?.total).toBe(2);
    expect(nextjs?.versions).toHaveLength(1);
    expect(nextjs?.versions[0]).toMatchObject({ version: '15.3.1', count: 2 });
    expect(nextjs?.versions[0].repos).toEqual([a, b]);
  });

  it('separates distinct versions and orders buckets by count then version desc', () => {
    const a = repo('a');
    const b = repo('b');
    const c = repo('c');
    writeNodeModules(a, 'next', '14.2.0');
    writeNodeModules(b, 'next', '15.3.1');
    writeNodeModules(c, 'next', '15.3.1');
    for (const r of [a, b, c]) writeManifest(r, { next: '*' });

    const report = buildScanReport([a, b, c], workdir);
    const nextjs = report.histogram.find((h) => h.stack === 'nextjs');
    expect(nextjs?.versions.map((v) => v.version)).toEqual(['15.3.1', '14.2.0']);
    expect(nextjs?.versions.map((v) => v.count)).toEqual([2, 1]);
  });

  it('ranks uncovered (stack, version) buckets by usage and tags the gap reason', () => {
    writeCatalog(workdir, [PAYLOAD_PACK]); // covers payload (name-level), not nextjs
    const a = repo('a');
    const b = repo('b');
    const c = repo('c');
    writeNodeModules(a, 'next', '14.2.0');
    writeNodeModules(b, 'next', '14.2.0');
    writeNodeModules(c, 'payload', '3.4.1');
    writeManifest(a, { next: '14' });
    writeManifest(b, { next: '14' });
    writeManifest(c, { payload: '3' });

    const report = buildScanReport([a, b, c], workdir);
    // payload is covered name-level → not a gap; nextjs has no covering pack → no-coverage gap.
    expect(report.gaps).toEqual([{ stack: 'nextjs', version: '14.2.0', count: 2, reason: 'no-coverage' }]);
    const payload = report.histogram.find((h) => h.stack === 'payload');
    expect(payload?.versions[0].covered).toBe(true);
  });

  it('reports a version-uncovered gap when the catalog root only covers other versions', () => {
    // The maintainer question this command exists to answer: "we ship react rules, but only for
    // 18 — how many repos have moved to 19?" Coverage reads the range off the guidance itself.
    writeCatalog(workdir, [REACT_PACK]);
    writeRule(workdir, 'effects-r18', 'react: ">=18 <19"');
    const a = repo('a');
    const b = repo('b');
    writeNodeModules(a, 'react', '19.0.0');
    writeNodeModules(b, 'react', '18.3.1');
    writeManifest(a, { react: '19' });
    writeManifest(b, { react: '18' });

    const report = buildScanReport([a, b], workdir);
    expect(report.gaps).toEqual([
      { stack: 'react', version: '19.0.0', count: 1, reason: 'version-uncovered' },
    ]);
    const react = report.histogram.find((h) => h.stack === 'react');
    expect(react?.versions.find((v) => v.version === '18.3.1')).toMatchObject({
      covered: true,
      matchedRange: '>=18 <19',
      reason: null,
    });
  });

  it('never reads a scanned repo as the coverage corpus when catalogRoot is omitted', () => {
    // A scanned repo's own rules must not count as org-wide coverage: that would mask the very
    // gaps the scan exists to find. The default is the cwd (the maintainer), never roots[0].
    const a = repo('a');
    writeNodeModules(a, 'react', '19.0.0');
    writeManifest(a, { react: '^19' });
    mkdirSync(join(a, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(a, 'llm', 'rules', 'local-react.md'),
      '---\ndescription: local\nstacks:\n  react: ">=19"\n---\nbody\n',
    );

    const defaulted = buildScanReport([a]);
    const explicitCwd = buildScanReport([a], process.cwd());
    expect(defaulted.gaps).toEqual(explicitCwd.gaps);

    // Pointing the corpus AT the scanned repo is what makes its own rule count — the old default.
    expect(buildScanReport([a], a).gaps).toEqual([]);
  });

  it('degrades to catalog-only coverage (with a warning) when the corpus cannot be read', () => {
    writeCatalog(workdir, [PAYLOAD_PACK]);
    mkdirSync(join(workdir, 'llm'), { recursive: true });
    writeFileSync(join(workdir, 'llm', 'packages.json'), 'this is not json');
    const a = repo('a');
    writeNodeModules(a, 'payload', '3.4.1');
    writeManifest(a, { payload: '^3' });

    const report = buildScanReport([a], workdir);
    expect(report.scanned).toBe(1);
    expect(report.warnings.some((w) => /packages\.json could not be read/.test(w))).toBe(true);
    // Catalog coverage still applies, so the scan stays useful instead of reporting phantom gaps.
    expect(report.gaps).toEqual([]);
  });

  it('counts repos with no detectable stacks as empty, not scanned-with-stacks', () => {
    const a = repo('a');
    const empty = repo('empty');
    writeNodeModules(a, 'next', '15.3.1');
    writeManifest(a, { next: '15' });
    writeManifest(empty, { lodash: '^4.0.0' }); // not a known stack

    const report = buildScanReport([a, empty], workdir);
    expect(report.scanned).toBe(2);
    expect(report.empty).toEqual([empty]);
    expect(report.skipped).toEqual([]);
  });
});

/** Minimal Response-like object for fetch mocks (raw media type → text(); arrays → json()). */
function ghResponse(body: unknown, opts: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = 200 } = opts;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: () => null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}
const gh404 = () => ghResponse('', { ok: false, status: 404 });

describe('runScanOrg — remote', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('scans --repos over the API and merges them into the histogram', async () => {
    writeCatalog(workdir, [PAYLOAD_PACK]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('acme/app/contents/package.json')) {
        return Promise.resolve(ghResponse({ dependencies: { next: '^15.0.0' } }));
      }
      if (url.includes('acme/app/contents/package-lock.json')) {
        return Promise.resolve(
          ghResponse({ lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.1' } } }),
        );
      }
      if (url.includes('acme/api/contents/package.json')) {
        return Promise.resolve(ghResponse({ dependencies: { payload: '^3.0.0' } }));
      }
      return Promise.resolve(gh404());
    });

    const report = await runScanOrg([], {
      repos: ['acme/app', 'acme/api'],
      token: 'tok',
      catalogRoot: workdir,
    });
    expect(report.scanned).toBe(2);
    expect(report.roots).toEqual(['acme/app', 'acme/api']);
    expect(report.histogram.find((h) => h.stack === 'nextjs')?.versions[0].version).toBe('15.3.1');
    expect(report.skipped).toEqual([]);
  });

  it('records a repo with no package.json as skipped and continues the scan', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('acme/good/contents/package.json')) {
        return Promise.resolve(ghResponse({ dependencies: { next: '^15.0.0' } }));
      }
      return Promise.resolve(gh404());
    });

    const report = await runScanOrg([], {
      repos: ['acme/good', 'acme/bad'],
      token: 'tok',
      catalogRoot: workdir,
    });
    expect(report.scanned).toBe(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toMatchObject({ repo: 'acme/bad', reason: 'not-found' });
  });

  it('throws when a remote scan is requested without a token', async () => {
    await expect(runScanOrg([], { repos: ['acme/app'] })).rejects.toThrow(/token/i);
  });

  it('merges a local repo and a remote repo into one report', async () => {
    const a = repo('a');
    writeNodeModules(a, 'next', '15.3.1');
    writeManifest(a, { next: '15' });
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('acme/api/contents/package.json')) {
        return Promise.resolve(ghResponse({ dependencies: { next: '^15.0.0' } }));
      }
      if (url.includes('acme/api/contents/package-lock.json')) {
        return Promise.resolve(
          ghResponse({ lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.1' } } }),
        );
      }
      return Promise.resolve(gh404());
    });

    const report = await runScanOrg([a], { repos: ['acme/api'], token: 'tok', catalogRoot: workdir });
    expect(report.scanned).toBe(2);
    const nextjs = report.histogram.find((h) => h.stack === 'nextjs');
    expect(nextjs?.versions[0]).toMatchObject({ version: '15.3.1', count: 2 });
    expect(nextjs?.versions[0].repos).toEqual([a, 'acme/api']);
  });
});
