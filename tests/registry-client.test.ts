import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fetchPackageMetadata,
  searchPackages,
  downloadTarball,
  verifyIntegrity,
  DEFAULT_REGISTRY,
} from '../src/registry/client.js';

// ---------------------------------------------------------------------------
// verifyIntegrity (pure, no mocking needed)
// ---------------------------------------------------------------------------

describe('verifyIntegrity', () => {
  it('returns true when hashes match', () => {
    expect(verifyIntegrity('sha512-abc123', 'sha512-abc123')).toBe(true);
  });

  it('returns false when hashes differ', () => {
    expect(verifyIntegrity('sha512-abc123', 'sha512-xyz789')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(verifyIntegrity('', 'sha512-abc123')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchPackageMetadata
// ---------------------------------------------------------------------------

describe('fetchPackageMetadata', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed metadata on success', async () => {
    const mockMetadata = {
      name: 'test-pack',
      'dist-tags': { latest: '1.0.0' },
      versions: {},
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockMetadata),
    });

    const result = await fetchPackageMetadata('test-pack');
    expect(result).toEqual(mockMetadata);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${DEFAULT_REGISTRY}/test-pack`,
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws on 404 with descriptive message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchPackageMetadata('nonexistent')).rejects.toThrow(
      'Package "nonexistent" not found in registry',
    );
  });

  it('throws on non-OK status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(fetchPackageMetadata('test-pack')).rejects.toThrow(
      'Registry request failed: 500 Internal Server Error',
    );
  });

  it('encodes scoped package names in the URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: '@scope/pack' }),
    });

    await fetchPackageMetadata('@scope/pack');
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${DEFAULT_REGISTRY}/@scope%2Fpack`);
  });

  it('uses custom registry URL when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'test' }),
    });

    await fetchPackageMetadata('test', 'https://custom.registry.io/');
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://custom.registry.io/test');
  });
});

// ---------------------------------------------------------------------------
// searchPackages
// ---------------------------------------------------------------------------

describe('searchPackages', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('appends bluetemberg-pack keyword by default', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ objects: [] }),
    });

    await searchPackages('my-query');
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('keywords%3Abluetemberg-pack');
    expect(calledUrl).toContain('my-query');
  });

  it('returns empty array when no results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ objects: [] }),
    });

    const results = await searchPackages('nothing');
    expect(results).toEqual([]);
  });

  it('maps search response objects to NpmSearchResult shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          objects: [
            {
              package: {
                name: 'pack-a',
                version: '1.0.0',
                description: 'A pack',
                keywords: ['bluetemberg-pack'],
              },
            },
          ],
        }),
    });

    const results = await searchPackages('pack');
    expect(results).toEqual([
      { name: 'pack-a', version: '1.0.0', description: 'A pack', keywords: ['bluetemberg-pack'] },
    ]);
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(searchPackages('test')).rejects.toThrow('Registry search failed: 503');
  });
});

// ---------------------------------------------------------------------------
// downloadTarball
// ---------------------------------------------------------------------------

describe('downloadTarball', () => {
  const originalFetch = globalThis.fetch;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `bt-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('downloads file and returns sha512 integrity string', async () => {
    const body = Buffer.from('fake-tarball-content');
    const expectedHash = `sha512-${createHash('sha512').update(body).digest('base64')}`;

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: readable,
    });

    const integrity = await downloadTarball('https://example.com/pack.tgz', tmpFile);
    expect(integrity).toBe(expectedHash);

    const written = readFileSync(tmpFile);
    expect(written.toString()).toBe('fake-tarball-content');
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(downloadTarball('https://example.com/missing.tgz', tmpFile)).rejects.toThrow(
      'Failed to download tarball: 404 Not Found',
    );
  });

  it('throws on empty response body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    await expect(downloadTarball('https://example.com/empty.tgz', tmpFile)).rejects.toThrow(
      'Empty response body',
    );
  });

  it('aborts when the response exceeds the byte cap', async () => {
    const body = Buffer.alloc(1024, 1);
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body: readable });

    await expect(downloadTarball('https://example.com/big.tgz', tmpFile, 512)).rejects.toThrow(
      'exceeds the maximum allowed size',
    );
  });
});
