import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from 'tar';

vi.mock('../src/registry/client.js', () => ({
  downloadTarball: vi.fn(),
}));

import { githubAdapter } from '../src/sources/adapters/github.js';
import { assertSafeTarEntry, extractTarball } from '../src/sources/tarball.js';
import { downloadTarball } from '../src/registry/client.js';
import type { ResolvedSource } from '../src/sources/types.js';

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

  it('downloads from codeload with no auth header when no token is configured', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, destPath: string) => {
      copyFileSync(fixtureTgz, destPath);
      return 'sha512-fixture';
    });

    await githubAdapter.fetch(resolvedFixture(), tmpDir);

    expect(downloadTarball).toHaveBeenCalledWith(
      'https://codeload.github.com/o/r/tar.gz/deadbeef',
      expect.any(String),
      { headers: undefined },
    );
  });

  it('downloads through the REST archive endpoint with a token, the only private-repo path', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, destPath: string) => {
      copyFileSync(fixtureTgz, destPath);
      return 'sha512-fixture';
    });

    await githubAdapter.fetch(resolvedFixture(), tmpDir, { token: 'gh-token' });

    expect(downloadTarball).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/tarball/deadbeef',
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
      }),
    );
  });

  it('routes a cursor.directory source through the same authenticated path', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, destPath: string) => {
      copyFileSync(fixtureTgz, destPath);
      return 'sha512-fixture';
    });

    // cursor.directory delegates resolution to GitHub, so its resolved URL is a codeload
    // one even though the spec carries no owner/repo.
    await githubAdapter.fetch(
      {
        spec: { type: 'cursor-directory', slug: 'some-plugin' },
        key: 'cursor-directory:some-plugin',
        ref: 'deadbeef',
        resolved: 'https://codeload.github.com/o/r/tar.gz/deadbeef',
        integrity: '',
      },
      tmpDir,
      { token: 'gh-token' },
    );

    expect(downloadTarball).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/tarball/deadbeef',
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
      }),
    );
  });

  it('leaves an unrecognised resolved URL alone rather than guessing an API path', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, destPath: string) => {
      copyFileSync(fixtureTgz, destPath);
      return 'sha512-fixture';
    });

    const resolved = { ...resolvedFixture(), resolved: 'https://mirror.example.com/o/r.tgz' };
    await githubAdapter.fetch(resolved, tmpDir, { token: 'gh-token' });

    expect(downloadTarball).toHaveBeenCalledWith('https://mirror.example.com/o/r.tgz', expect.any(String), {
      headers: undefined,
    });
  });
});

/** A resolved GitHub source pointing at the codeload archive for `o/r@deadbeef`. */
function resolvedFixture(): ResolvedSource {
  return {
    spec: { type: 'github', owner: 'o', repo: 'r', ref: 'deadbeef', path: 'rules' },
    key: 'github:o/r:rules',
    ref: 'deadbeef',
    resolved: 'https://codeload.github.com/o/r/tar.gz/deadbeef',
    integrity: '',
  };
}

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

describe('extractTarball — security + size cap', () => {
  it('rejects a tarball whose extracted bytes exceed the cap', async () => {
    const dest = createTmpDir();
    try {
      await expect(extractTarball(fixtureTgz, dest, 'toobig', { maxBytes: 10 })).rejects.toThrow(
        'exceeds the maximum extracted size',
      );
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('rejects cleanly (no unhandled error) on a symlink entry', async () => {
    const evilSrc = createTmpDir();
    const wrapper = join(evilSrc, 'evil-repo');
    mkdirSync(wrapper, { recursive: true });
    writeFileSync(join(wrapper, 'real.md'), 'ok\n');
    symlinkSync('/etc/passwd', join(wrapper, 'link'));
    const evilTgz = join(createTmpDir(), 'evil.tgz');
    await create({ file: evilTgz, cwd: evilSrc, gzip: true }, ['evil-repo']);

    const dest = createTmpDir();
    try {
      await expect(extractTarball(evilTgz, dest, 'evil')).rejects.toThrow('symlink');
      // The symlink must not have been written.
      expect(existsSync(join(dest, 'link'))).toBe(false);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
