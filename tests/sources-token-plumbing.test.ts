/**
 * GITHUB_TOKEN reaches the adapters.
 *
 * `SourceNetOptions.token` and the GitHub adapter's use of it both predate this test,
 * but no source command ever populated it — so private repos were unreachable. These
 * tests assert every command threads the environment token through both adapter calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ResolvedSource, SourceNetOptions, SourceSpec } from '../src/sources/types.js';

/** Every (call, options) pair the fake adapter sees, in order. */
const calls: Array<{ phase: 'resolve' | 'fetch'; options: SourceNetOptions | undefined }> = [];

vi.mock('../src/sources/adapters/github.js', () => ({
  githubAdapter: {
    type: 'github',
    resolve: async (spec: SourceSpec, options?: SourceNetOptions): Promise<ResolvedSource> => {
      calls.push({ phase: 'resolve', options });
      if (spec.type !== 'github') throw new Error('unexpected spec');
      return {
        spec,
        key: `github:${spec.owner}/${spec.repo}`,
        ref: 'a'.repeat(40),
        resolved: `https://codeload.github.com/${spec.owner}/${spec.repo}/tar.gz/${'a'.repeat(40)}`,
        integrity: '',
      };
    },
    fetch: async (_resolved: ResolvedSource, tmpDir: string, options?: SourceNetOptions) => {
      calls.push({ phase: 'fetch', options });
      mkdirSync(join(tmpDir, 'rules'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'rules', 'sample.mdc'),
        '---\ndescription: Sample\nglobs: "**/*"\nalwaysApply: true\n---\n\nSample rule.\n',
      );
      return { rawDir: tmpDir, integrity: 'sha512-fake' };
    },
  },
}));

import { addSource, installSources, updateSources } from '../src/sources/registry.js';
import { writeSourceLock, writeSourceManifest } from '../src/sources/manifest.js';

const SPEC = 'github:acme/private-rules';
const KEY = 'github:acme/private-rules';

function createProject(): string {
  const dir = join(tmpdir(), `bt-src-token-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'llm'), { recursive: true });
  writeFileSync(
    join(dir, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['cursor'], source: 'llm' }),
  );
  return dir;
}

describe('source commands thread the environment GitHub token', () => {
  let root: string;
  const savedEnv = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };

  beforeEach(() => {
    root = createProject();
    calls.length = 0;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function seedManifest(): void {
    writeSourceManifest(
      root,
      { sources: { [KEY]: { type: 'github', owner: 'acme', repo: 'private-rules', ref: 'HEAD', path: '' } } },
      'llm',
    );
    writeSourceLock(root, { lockfileVersion: 1, sources: {} }, 'llm');
  }

  it('addSource passes GITHUB_TOKEN to both resolve and fetch', async () => {
    process.env.GITHUB_TOKEN = 'gh-secret';

    await addSource(root, SPEC, { silent: true });

    expect(calls.map((c) => c.phase)).toEqual(['resolve', 'fetch']);
    expect(calls.every((c) => c.options?.token === 'gh-secret')).toBe(true);
  });

  it('installSources passes GITHUB_TOKEN to both resolve and fetch', async () => {
    process.env.GITHUB_TOKEN = 'gh-secret';
    seedManifest();

    await installSources(root, { silent: true });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.options?.token === 'gh-secret')).toBe(true);
  });

  it('updateSources passes GITHUB_TOKEN to both resolve and fetch', async () => {
    process.env.GITHUB_TOKEN = 'gh-secret';
    seedManifest();

    await updateSources(root, undefined, { silent: true });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.options?.token === 'gh-secret')).toBe(true);
  });

  it('accepts GH_TOKEN as an alias', async () => {
    process.env.GH_TOKEN = 'gh-alias';

    await addSource(root, SPEC, { silent: true });

    expect(calls.every((c) => c.options?.token === 'gh-alias')).toBe(true);
  });

  it('passes no token when neither variable is set', async () => {
    await addSource(root, SPEC, { silent: true });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.options?.token === undefined)).toBe(true);
  });
});
