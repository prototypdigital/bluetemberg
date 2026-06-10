import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from 'tar';

vi.mock('../src/registry/client.js', () => ({
  downloadTarball: vi.fn(),
}));

import { githubAdapter } from '../src/sources/adapters/github.js';
import { assertSafeTarEntry } from '../src/sources/tarball.js';
import { downloadTarball } from '../src/registry/client.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-gh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const originalFetch = globalThis.fetch;

/** A codeload-style tarball: a single top-level wrapper dir (stripped on extract). */
let fixtureTgz: string;

beforeAll(async () => {
  const fixtureSrc = createTmpDir();
  const wrapper = join(fixtureSrc, 'awesome-repo-deadbeef');
  mkdirSync(join(wrapper, 'rules'), { recursive: true });
  writeFileSync(
    join(wrapper, 'rules', 'clean.mdc'),
    '---\ndescription: Clean\nglobs: "**/*"\nalwaysApply: true\n---\n\nClean code.\n',
  );
  writeFileSync(join(wrapper, 'README.md'), '# Repo\n');
  fixtureTgz = join(createTmpDir(), 'repo.tgz');
  await create({ file: fixtureTgz, cwd: fixtureSrc, gzip: true }, ['awesome-repo-deadbeef']);
});

describe('githubAdapter.resolve', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('pins the commit SHA and builds a codeload tarball URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    }) as typeof fetch;

    const resolved = await githubAdapter.resolve({
      type: 'github',
      owner: 'PatrickJS',
      repo: 'awesome-cursorrules',
      ref: 'HEAD',
      path: 'rules',
    });

    expect(resolved.ref).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(resolved.key).toBe('github:PatrickJS/awesome-cursorrules:rules');
    expect(resolved.resolved).toBe(
      'https://codeload.github.com/PatrickJS/awesome-cursorrules/tar.gz/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
  });

  it('throws a clear error on 404', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }) as typeof fetch;
    await expect(
      githubAdapter.resolve({ type: 'github', owner: 'no', repo: 'such', ref: 'HEAD', path: '' }),
    ).rejects.toThrow('repo or ref not found');
  });

  it('throws a token hint on 403', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }) as typeof fetch;
    await expect(
      githubAdapter.resolve({ type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: '' }),
    ).rejects.toThrow('rate limited');
  });
});

describe('githubAdapter.fetch', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.mocked(downloadTarball).mockReset();
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads + extracts the tarball into tmpDir and reports rootSubdir + integrity', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, destPath: string) => {
      copyFileSync(fixtureTgz, destPath);
      return 'sha512-fixture';
    });

    const raw = await githubAdapter.fetch(
      {
        spec: { type: 'github', owner: 'o', repo: 'r', ref: 'deadbeef', path: 'rules' },
        key: 'github:o/r:rules',
        ref: 'deadbeef',
        resolved: 'https://codeload.github.com/o/r/tar.gz/deadbeef',
        integrity: '',
      },
      tmpDir,
    );

    expect(raw.rootSubdir).toBe('rules');
    expect(raw.integrity).toBe('sha512-fixture');
    expect(existsSync(join(tmpDir, 'rules', 'clean.mdc'))).toBe(true);
    expect(existsSync(join(tmpDir, 'README.md'))).toBe(true);
  });
});

describe('assertSafeTarEntry — extraction security policy', () => {
  it('rejects symlink and hardlink entries', () => {
    expect(() => assertSafeTarEntry('evil', 'pkg/link', 'SymbolicLink')).toThrow('symlink');
    expect(() => assertSafeTarEntry('evil', 'pkg/hard', 'Link')).toThrow('symlink');
  });

  it('rejects ".." path traversal segments', () => {
    expect(() => assertSafeTarEntry('evil', 'pkg/../../etc/passwd', 'File')).toThrow('path traversal');
  });

  it('allows normal files (including names that merely contain "..")', () => {
    expect(() => assertSafeTarEntry('ok', 'rules/my..file.md', 'File')).not.toThrow();
    expect(() => assertSafeTarEntry('ok', 'rules/clean.mdc', 'File')).not.toThrow();
  });
});
