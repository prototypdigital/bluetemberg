import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import {
  resolveExternalSourceDirs,
  addSource,
  removeSource,
  installSources,
} from '../src/sources/registry.js';
import {
  writeSourceManifest,
  writeSourceLock,
  readSourceManifest,
  readSourceLock,
} from '../src/sources/manifest.js';
import { sourceContentDir } from '../src/sources/cache.js';
import type { ResolvedSource, SourceSpec } from '../src/sources/types.js';

// A fake github adapter: resolve pins a fixed SHA, fetch writes a native rule into tmpDir.
vi.mock('../src/sources/adapters/github.js', () => ({
  githubAdapter: {
    type: 'github',
    resolve: async (spec: SourceSpec): Promise<ResolvedSource> => {
      if (spec.type !== 'github') throw new Error('unexpected spec');
      const key = spec.path
        ? `github:${spec.owner}/${spec.repo}:${spec.path}`
        : `github:${spec.owner}/${spec.repo}`;
      return {
        spec,
        key,
        ref: 'a'.repeat(40),
        resolved: 'https://codeload.github.com/x/tar.gz/a',
        integrity: '',
      };
    },
    fetch: async (resolved: ResolvedSource, tmpDir: string) => {
      const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
      const { join: j } = await import('node:path');
      mk(j(tmpDir, 'rules'), { recursive: true });
      wf(
        j(tmpDir, 'rules', 'sample.mdc'),
        '---\ndescription: Sample\nglobs: "**/*"\nalwaysApply: true\n---\n\nSample rule.\n',
      );
      const rootSubdir = resolved.spec.type === 'github' ? resolved.spec.path || undefined : undefined;
      return { rawDir: tmpDir, rootSubdir, integrity: 'sha512-fake' };
    },
  },
}));

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-src-reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupProject(root: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['cursor', 'claude'], source: 'llm' }),
  );
}

/** Seed a translated source in the cache (rules/<name>.md) and return its key + ref. */
function seedCachedSource(
  root: string,
  key: string,
  ref: string,
  ruleName: string,
  description: string,
): void {
  const dir = sourceContentDir(root, key, ref);
  mkdirSync(join(dir, 'rules'), { recursive: true });
  writeFileSync(
    join(dir, 'rules', `${ruleName}.md`),
    `---\ndescription: ${description}\nscope: "**"\n---\n\n# ${ruleName}\n`,
  );
  writeFileSync(join(dir, '.bluetemberg-integrity'), 'sha512-seed\n');
}

describe('resolveExternalSourceDirs', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty when nothing is configured', () => {
    expect(resolveExternalSourceDirs(root)).toEqual({ dirs: [], warnings: [] });
  });

  it('returns the cached dir for a locked + cached source', () => {
    const key = 'github:o/r:rules';
    writeSourceManifest(root, {
      sources: { [key]: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: 'rules' } },
    });
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: { [key]: { type: 'github', ref: 'abc123', resolved: 'x', integrity: 'y' } },
    });
    seedCachedSource(root, key, 'abc123', 'ext', 'External');

    const { dirs, warnings } = resolveExternalSourceDirs(root);
    expect(dirs).toEqual([sourceContentDir(root, key, 'abc123')]);
    expect(warnings).toEqual([]);
  });

  it('warns when locked but not cached', () => {
    const key = 'github:o/r';
    writeSourceManifest(root, {
      sources: { [key]: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: '' } },
    });
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: { [key]: { type: 'github', ref: 'abc123', resolved: 'x', integrity: 'y' } },
    });

    const { dirs, warnings } = resolveExternalSourceDirs(root);
    expect(dirs).toEqual([]);
    expect(warnings[0]).toContain('locked but not cached');
  });

  it('warns when a manifest source has no lock entry', () => {
    const key = 'github:o/r';
    writeSourceManifest(root, {
      sources: { [key]: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: '' } },
    });
    writeSourceLock(root, { lockfileVersion: 1, sources: {} });

    const { warnings } = resolveExternalSourceDirs(root);
    expect(warnings[0]).toContain('no lockfile entry');
  });

  it('warns about a stale lock entry not in the manifest', () => {
    writeSourceManifest(root, { sources: {} });
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: { 'github:gone/x': { type: 'github', ref: 'abc', resolved: 'x', integrity: 'y' } },
    });

    const { warnings } = resolveExternalSourceDirs(root);
    expect(warnings[0]).toContain('not in the manifest');
  });
});

describe('addSource / removeSource / installSources', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('adds a github source: writes manifest + lock and translates into the cache', async () => {
    const installed = await addSource(root, 'github:PatrickJS/awesome-cursorrules:rules', { silent: true });

    expect(installed.key).toBe('github:PatrickJS/awesome-cursorrules:rules');
    expect(installed.ref).toBe('a'.repeat(40));

    const manifest = readSourceManifest(root);
    expect(manifest.sources['github:PatrickJS/awesome-cursorrules:rules']).toMatchObject({
      type: 'github',
      path: 'rules',
    });

    const lock = readSourceLock(root);
    expect(lock.sources['github:PatrickJS/awesome-cursorrules:rules'].integrity).toBe('sha512-fake');

    // Translated native rule landed in the cache.
    const ruleFile = join(installed.path, 'rules', 'sample.md');
    expect(existsSync(ruleFile)).toBe(true);
  });

  it('removes a source and prunes its manifest + lock entries', async () => {
    await addSource(root, 'github:o/r:rules', { silent: true });
    removeSource(root, 'github:o/r:rules', { silent: true });

    expect(readSourceManifest(root).sources).toEqual({});
    expect(readSourceLock(root).sources).toEqual({});
  });

  it('installSources restores a cached source from the lock without re-resolving', async () => {
    await addSource(root, 'github:o/r:rules', { silent: true });
    const installed = await installSources(root, { silent: true });
    expect(installed).toHaveLength(1);
    expect(installed[0].ref).toBe('a'.repeat(40));
  });
});

describe('sync integration with external sources', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('sync emits rules from a cached external source', async () => {
    const { sync, loadConfig } = await import('../src/sync/index.js');
    const key = 'github:o/r:rules';
    writeSourceManifest(root, {
      sources: { [key]: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: 'rules' } },
    });
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: { [key]: { type: 'github', ref: 'abc123', resolved: 'x', integrity: 'y' } },
    });
    seedCachedSource(root, key, 'abc123', 'community-rule', 'from external source');

    const results = await sync(root, { config: loadConfig(root), silent: true });

    expect(results.errors).toEqual([]);
    expect(existsSync(join(root, '.cursor', 'rules', 'community-rule.mdc'))).toBe(true);
  });

  it('local rules win over external sources with the same name', async () => {
    const { sync, loadConfig } = await import('../src/sync/index.js');
    const key = 'github:o/r:rules';
    writeSourceManifest(root, {
      sources: { [key]: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: 'rules' } },
    });
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: { [key]: { type: 'github', ref: 'abc123', resolved: 'x', integrity: 'y' } },
    });
    seedCachedSource(root, key, 'abc123', 'shared', 'external version');
    writeFileSync(
      join(root, 'llm', 'rules', 'shared.md'),
      '---\ndescription: local version\nscope: "**"\n---\n\n# Local\n',
    );

    const results = await sync(root, { config: loadConfig(root), silent: true });
    expect(results.errors).toEqual([]);

    const output = readFileSync(join(root, '.cursor', 'rules', 'shared.mdc'), 'utf8');
    expect(output).toContain('local version');
    expect(output).not.toContain('external version');
  });
});
