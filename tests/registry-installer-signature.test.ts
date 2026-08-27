/**
 * Installer-level signature verification tests.
 *
 * These tests mock `globalThis.fetch` to control both the tarball response and the
 * registry keys endpoint (`/-/npm/v1/keys`), and mock `extractTarball` so we never
 * need a real archive on disk. All tests run against a real ECDSA P-256 key pair.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock extractTarball before importing installPackVersion so the module picks
// up the mock at import time (ESM static analysis runs top-to-bottom).
vi.mock('../src/sources/tarball.js', () => ({
  extractTarball: vi.fn().mockResolvedValue(undefined),
}));

// Clear the keys cache between tests so fetch counts are predictable.
import { clearRegistryKeysCache, DEFAULT_REGISTRY } from '../src/registry/client.js';
import { installPackVersion } from '../src/registry/installer.js';
import type { NpmPackageMetadata, NpmRegistryKey } from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
const TEST_KEYID = 'SHA256:testinstallkey';

const testRegistryKey: NpmRegistryKey = {
  expires: null,
  keyid: TEST_KEYID,
  keytype: 'ecdsa-sha2-nistp256',
  scheme: 'ecdsa-sha2-nistp256',
  key: pubKeyDer.toString('base64'),
};

function signPayload(payload: string): string {
  const signer = createSign('SHA256');
  signer.update(payload, 'utf8');
  return signer.sign(privateKey).toString('base64');
}

const FAKE_TARBALL_BYTES = Buffer.from('fake-tarball');
const FAKE_INTEGRITY = `sha512-${createHash('sha512').update(FAKE_TARBALL_BYTES).digest('base64')}`;

function makeMetadata(
  name: string,
  version: string,
  opts: { signed?: boolean; integrity?: string } = {},
): NpmPackageMetadata {
  const integrity = opts.integrity ?? FAKE_INTEGRITY;
  const signed = opts.signed ?? true;
  const signatures = signed
    ? [{ keyid: TEST_KEYID, sig: signPayload(`${name}@${version}:${integrity}`) }]
    : [];

  return {
    name,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dist: {
          tarball: `${DEFAULT_REGISTRY}/${name}/-/${name}-${version}.tgz`,
          shasum: 'abc',
          integrity,
          signatures,
        },
      },
    },
  };
}

/** Build a fetch mock that routes tarball vs. keys requests by URL. */
function buildFetchMock(opts: { keysOk?: boolean; keysKeys?: NpmRegistryKey[] } = {}) {
  const keysOk = opts.keysOk ?? true;
  const keysKeys = opts.keysKeys ?? [testRegistryKey];

  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/-/npm/v1/keys')) {
      if (!keysOk) {
        return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ keys: keysKeys }),
      });
    }

    // Tarball response.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(FAKE_TARBALL_BYTES);
        controller.close();
      },
    });
    return Promise.resolve({ ok: true, body: readable });
  });
}

function createTmpRoot(): string {
  const dir = join(tmpdir(), `bt-sig-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installPackVersion — signature verification', () => {
  const originalFetch = globalThis.fetch;
  let root: string;

  beforeEach(() => {
    root = createTmpRoot();
    clearRegistryKeysCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearRegistryKeysCache();
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a pack with a valid registry signature', async () => {
    globalThis.fetch = buildFetchMock();
    const metadata = makeMetadata('my-pack', '1.0.0');

    const entry = await installPackVersion(root, metadata, '1.0.0');

    expect(entry.integrity).toBe(FAKE_INTEGRITY);
    expect(entry.keyid).toBe(TEST_KEYID);
  });

  it('rejects install when default registry returns no signatures', async () => {
    globalThis.fetch = buildFetchMock();
    const metadata = makeMetadata('my-pack', '1.0.0', { signed: false });

    await expect(installPackVersion(root, metadata, '1.0.0')).rejects.toThrow(/has no registry signature/);
  });

  it('rejects install when signature verification fails (bad sig)', async () => {
    // Use a fresh key pair that does NOT match the registered key.
    const { privateKey: wrongKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const badSig = createSign('SHA256').update('wrong-payload', 'utf8').sign(wrongKey).toString('base64');

    const metadata = makeMetadata('my-pack', '1.0.0');
    // Override the sig with one signed by the wrong key.
    metadata.versions['1.0.0'].dist.signatures = [{ keyid: TEST_KEYID, sig: badSig }];

    globalThis.fetch = buildFetchMock();

    await expect(installPackVersion(root, metadata, '1.0.0')).rejects.toThrow(
      /Registry signature verification failed/,
    );
  });

  it('allows install when non-default registry + skipSignatureVerification: true', async () => {
    const customRegistry = 'https://my.private.registry.io';
    globalThis.fetch = buildFetchMock();
    const metadata: NpmPackageMetadata = {
      name: 'internal-pack',
      'dist-tags': { latest: '2.0.0' },
      versions: {
        '2.0.0': {
          name: 'internal-pack',
          version: '2.0.0',
          dist: {
            // Tarball host must match registry host to pass the host-pin check.
            tarball: `${customRegistry}/internal-pack/-/internal-pack-2.0.0.tgz`,
            shasum: 'xyz',
            integrity: FAKE_INTEGRITY,
            signatures: [],
          },
        },
      },
    };

    // Should not throw even though there are no signatures — but must say so: the
    // acceptance bar for the escape hatch is a log line at the moment the weakened
    // guarantee is used, so a CI transcript shows it without anyone running `verify`.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = await installPackVersion(root, metadata, '2.0.0', {
      registryUrl: customRegistry,
      skipSignatureVerification: true,
    });

    expect(entry.integrity).toBe(FAKE_INTEGRITY);
    expect(entry.keyid).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Signature verification skipped for "internal-pack@2\.0\.0"/),
    );

    // The cache-hit path makes the same promise: reinstalling the unsigned pack from
    // cache still announces that no signature ever covered it.
    warn.mockClear();
    await installPackVersion(root, metadata, '2.0.0', {
      registryUrl: customRegistry,
      skipSignatureVerification: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Signature verification skipped for "internal-pack@2\.0\.0"/),
    );
    warn.mockRestore();
  });

  it('does not warn when a signature was actually verified', async () => {
    globalThis.fetch = buildFetchMock();
    const metadata = makeMetadata('my-pack', '1.0.0');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await installPackVersion(root, metadata, '1.0.0');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('always verifies signature on default registry even when skipSignatureVerification: true', async () => {
    globalThis.fetch = buildFetchMock();
    const metadata = makeMetadata('my-pack', '1.0.0', { signed: false });

    // skipSignatureVerification should be ignored for the default registry.
    await expect(
      installPackVersion(root, metadata, '1.0.0', { skipSignatureVerification: true }),
    ).rejects.toThrow(/has no registry signature/);
  });

  it('cleans up the pack directory on signature failure', async () => {
    const { privateKey: wrongKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const badSig = createSign('SHA256').update('wrong', 'utf8').sign(wrongKey).toString('base64');

    const metadata = makeMetadata('cleanup-pack', '1.0.0');
    metadata.versions['1.0.0'].dist.signatures = [{ keyid: TEST_KEYID, sig: badSig }];

    globalThis.fetch = buildFetchMock();

    await expect(installPackVersion(root, metadata, '1.0.0')).rejects.toThrow(
      /Registry signature verification failed/,
    );

    // The destination directory must have been removed by the catch block.
    const { join: pathJoin } = await import('node:path');
    const dest = pathJoin(root, '.bluetemberg/packs/cleanup-pack/1.0.0');
    const { existsSync } = await import('node:fs');
    expect(existsSync(dest)).toBe(false);
  });
});
