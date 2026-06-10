import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from 'tar';

vi.mock('../src/registry/client.js', () => ({
  downloadTarball: vi.fn(),
}));

import { cursorDirectoryAdapter } from '../src/sources/adapters/cursor-directory.js';
import { downloadTarball } from '../src/registry/client.js';
import type { ResolvedSource } from '../src/sources/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-cursor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const originalFetch = globalThis.fetch;

/** Route the mocked fetch by URL: Supabase plugins query vs GitHub commits API. */
function mockRouter(plugins: unknown, sha = 'cafebabecafebabecafebabecafebabecafebabe'): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/rest/v1/plugins')) {
      return { ok: true, status: 200, json: () => Promise.resolve(plugins) } as Response;
    }
    if (url.includes('api.github.com/repos')) {
      return { ok: true, status: 200, json: () => Promise.resolve({ sha }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

describe('cursorDirectoryAdapter.resolve', () => {
  beforeEach(() => {
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL = 'https://test.supabase.co';
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL;
    delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY;
    globalThis.fetch = originalFetch;
  });

  it('resolves a slug → repository → GitHub commit SHA', async () => {
    mockRouter([{ slug: 'nextjs', name: 'Next.js', repository: 'https://github.com/acme/next-rules' }]);

    const resolved = await cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: 'nextjs' });

    expect(resolved.key).toBe('cursor-directory:nextjs');
    expect(resolved.ref).toBe('cafebabecafebabecafebabecafebabecafebabe');
    expect(resolved.resolved).toContain('codeload.github.com/acme/next-rules/tar.gz/');
    expect(resolved.repository).toBe('https://github.com/acme/next-rules');
  });

  it('throws a clear error when env overrides are explicitly empty', async () => {
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL = '';
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY = '';
    try {
      await expect(cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: 'x' })).rejects.toThrow(
        'not configured',
      );
    } finally {
      delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL;
      delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY;
    }
  });

  it('rejects the "*" wildcard for add', async () => {
    await expect(cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: '*' })).rejects.toThrow(
      'not supported for `add`',
    );
  });

  it('throws when the plugin is not found', async () => {
    mockRouter([]);
    await expect(cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: 'ghost' })).rejects.toThrow(
      'not found or not active',
    );
  });

  it('throws when the plugin has no GitHub repository', async () => {
    mockRouter([{ slug: 'norepo', name: 'No Repo', repository: null }]);
    await expect(
      cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: 'norepo' }),
    ).rejects.toThrow('no GitHub repository');
  });

  it('surfaces an access-denied (RLS/key) error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }) as typeof fetch;
    await expect(cursorDirectoryAdapter.resolve({ type: 'cursor-directory', slug: 'x' })).rejects.toThrow(
      'access denied',
    );
  });
});

describe('cursorDirectoryAdapter.search', () => {
  beforeEach(() => {
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL = 'https://test.supabase.co';
    process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_URL;
    delete process.env.BLUETEMBERG_CURSOR_DIRECTORY_KEY;
    globalThis.fetch = originalFetch;
  });

  it('maps plugin rows to installable specs', async () => {
    mockRouter([
      { slug: 'react', name: 'React', description: 'React rules' },
      { slug: 'vue', name: 'Vue' },
    ]);

    const results = await cursorDirectoryAdapter.search!('rea', {});
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      type: 'cursor-directory',
      spec: 'cursor-directory:react',
      name: 'React',
      description: 'React rules',
    });
    expect(results[1].spec).toBe('cursor-directory:vue');
  });
});

describe('cursorDirectoryAdapter.fetch — delegates to GitHub extraction', () => {
  let fixtureTgz: string;

  beforeAll(async () => {
    const src = createTmpDir();
    const wrapper = join(src, 'next-rules-cafebabe');
    mkdirSync(join(wrapper, 'rules'), { recursive: true });
    writeFileSync(join(wrapper, 'rules', 'a.mdc'), '---\ndescription: A\n---\n\nbody\n');
    fixtureTgz = join(createTmpDir(), 'repo.tgz');
    await create({ file: fixtureTgz, cwd: src, gzip: true }, ['next-rules-cafebabe']);
  });

  it('downloads + extracts the resolved codeload tarball', async () => {
    vi.mocked(downloadTarball).mockImplementation(async (_url: string, dest: string) => {
      copyFileSync(fixtureTgz, dest);
      return 'sha512-cursor';
    });

    const tmpDir = createTmpDir();
    const resolved: ResolvedSource = {
      spec: { type: 'cursor-directory', slug: 'nextjs' },
      key: 'cursor-directory:nextjs',
      ref: 'cafebabe',
      resolved: 'https://codeload.github.com/acme/next-rules/tar.gz/cafebabe',
      integrity: '',
      repository: 'https://github.com/acme/next-rules',
    };

    const raw = await cursorDirectoryAdapter.fetch(resolved, tmpDir);

    expect(raw.integrity).toBe('sha512-cursor');
    expect(existsSync(join(tmpDir, 'rules', 'a.mdc'))).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
