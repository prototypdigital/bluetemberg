import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the adapter registry + translate step so we can drive integrity verification
// in isolation. verifyIntegrity (a pure string compare) is exercised for real.
vi.mock('../src/sources/adapters/index.js', () => ({ getAdapter: vi.fn() }));
vi.mock('../src/sources/translate/index.js', () => ({ translateDir: vi.fn() }));

import { installResolvedSource } from '../src/sources/pipeline.js';
import { getAdapter } from '../src/sources/adapters/index.js';
import { sourceContentDir } from '../src/sources/cache.js';
import type { ResolvedSource, SourceAdapter } from '../src/sources/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fake adapter whose `fetch` reports a fixed integrity for the downloaded bytes. */
function fakeAdapter(downloadedIntegrity: string, verifiesIntegrity: boolean): SourceAdapter {
  return {
    type: 'prpm',
    verifiesIntegrity,
    resolve: vi.fn(),
    fetch: vi.fn(async (_resolved: ResolvedSource, tmpDir: string) => ({
      rawDir: tmpDir,
      integrity: downloadedIntegrity,
    })),
  };
}

function lockedResolved(integrity: string): ResolvedSource {
  return {
    spec: { type: 'prpm', name: 'x', range: 'latest' },
    key: 'prpm:x',
    ref: '1.0.0',
    resolved: 'https://prpm/x.tgz',
    integrity,
  };
}

describe('installResolvedSource — integrity verification', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    vi.mocked(getAdapter).mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('throws when a verifiable source download does not match the locked integrity', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter('sha512-DOWNLOADED', true));

    await expect(installResolvedSource(root, lockedResolved('sha512-LOCKED'))).rejects.toThrow(
      'Integrity mismatch',
    );
    // Cleans up the destination on failure.
    expect(() =>
      readFileSync(join(sourceContentDir(root, 'prpm:x', '1.0.0'), '.bluetemberg-integrity')),
    ).toThrow();
  });

  it('succeeds when the download matches the locked integrity', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter('sha512-LOCKED', true));

    const entry = await installResolvedSource(root, lockedResolved('sha512-LOCKED'));
    expect(entry.integrity).toBe('sha512-LOCKED');
  });

  it('skips verification for sources that opt out (e.g. GitHub codeload archives)', async () => {
    const ghAdapter = fakeAdapter('sha512-DIFFERENT', false);
    ghAdapter.type = 'github';
    vi.mocked(getAdapter).mockReturnValue(ghAdapter);

    const resolved: ResolvedSource = {
      spec: { type: 'github', owner: 'o', repo: 'r', ref: 'abc', path: '' },
      key: 'github:o/r',
      ref: 'abc',
      resolved: 'https://codeload/x',
      integrity: 'sha512-LOCKED',
    };

    const entry = await installResolvedSource(root, resolved);
    expect(entry.integrity).toBe('sha512-DIFFERENT');
  });

  it('skips verification on a first-time add (empty locked integrity = trust-on-first-use)', async () => {
    vi.mocked(getAdapter).mockReturnValue(fakeAdapter('sha512-FRESH', true));

    const entry = await installResolvedSource(root, lockedResolved(''));
    expect(entry.integrity).toBe('sha512-FRESH');
  });
});
