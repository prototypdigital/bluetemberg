/**
 * Where credentials are and are not sent.
 *
 * The unit tests in `registry-auth.test.ts` cover *resolving* a credential; these cover
 * *transmitting* one — the boundaries that turn a working private registry into a
 * leaked token if they slip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/sources/tarball.js', () => ({
  extractTarball: vi.fn().mockResolvedValue(undefined),
}));

import { clearRegistryKeysCache, downloadTarball, fetchPackageMetadata } from '../src/registry/client.js';
import { clearRegistryAuthCache } from '../src/registry/auth.js';
import { installPackVersion } from '../src/registry/installer.js';
import { isolateRegistryAuth } from './helpers/registry-auth.js';
import type { NpmPackageMetadata } from '../src/types.js';

const npmrc = isolateRegistryAuth();

const REGISTRY = 'https://private.registry.test';
const CDN = 'https://cdn.elsewhere.test';
const TARBALL_BYTES = Buffer.from('fake-tarball');
const TARBALL_INTEGRITY = `sha512-${createHash('sha512').update(TARBALL_BYTES).digest('base64')}`;

function metadataFor(tarballUrl: string): NpmPackageMetadata {
  return {
    name: 'private-pack',
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name: 'private-pack',
        version: '1.0.0',
        dist: { tarball: tarballUrl, integrity: TARBALL_INTEGRITY, shasum: 'abc', signatures: [] },
      },
    },
  } as unknown as NpmPackageMetadata;
}

/** Record the Authorization header seen at each requested URL. */
function recordingFetch(): { seen: Map<string, string | undefined>; fn: typeof globalThis.fetch } {
  const seen = new Map<string, string | undefined>();
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.set(href, headers.Authorization);

    if (href.endsWith('.tgz')) {
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(TARBALL_BYTES);
            controller.close();
          },
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ keys: [] }) } as unknown as Response;
  });
  return { seen, fn: fn as unknown as typeof globalThis.fetch };
}

describe('credential transmission', () => {
  const originalFetch = globalThis.fetch;
  let root: string;

  beforeEach(() => {
    clearRegistryKeysCache();
    root = mkdtempSync(join(tmpdir(), 'bluetemberg-auth-wiring-'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  });

  /** Seed the project `.npmrc` where the install actually looks for it: under `root`. */
  function writeRootNpmrc(contents: string): void {
    writeFileSync(join(root, '.npmrc'), contents);
    clearRegistryAuthCache();
  }

  /**
   * The registry URL comes from a committed `llm/packages.json`, so a bare env token —
   * which names no host — must not follow it to whatever host the file chose. Without
   * this, cloning a repo and running `install` hands it your npm token.
   */
  it('never sends a bare env token to a registry the manifest chose', async () => {
    process.env.NPM_TOKEN = 'env-token';
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;

    await fetchPackageMetadata('private-pack', 'https://registry.attacker.test');

    expect(seen.get('https://registry.attacker.test/private-pack')).toBeUndefined();
  });

  it('withholds a credential from a plaintext http registry', async () => {
    writeRootNpmrc('//insecure.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;

    await fetchPackageMetadata('private-pack', 'http://insecure.registry.test', root);

    expect(seen.get('http://insecure.registry.test/private-pack')).toBeUndefined();
  });

  it('sends the credential when fetching metadata from the configured registry', async () => {
    npmrc.writeProjectNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;

    await fetchPackageMetadata('private-pack', REGISTRY);

    expect(seen.get(`${REGISTRY}/private-pack`)).toBe('Bearer reg-token');
  });

  it('sends the credential when downloading a tarball from the registry host', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;

    const tarball = `${REGISTRY}/private-pack/-/private-pack-1.0.0.tgz`;
    await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
    });

    expect(seen.get(tarball)).toBe('Bearer reg-token');
  });

  it('never sends the credential to a tarball host outside the registry', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tarball = `${CDN}/private-pack-1.0.0.tgz`;
    await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
      allowExternalTarballHost: true,
    });

    expect(seen.get(tarball)).toBeUndefined();
    warn.mockRestore();
  });

  /**
   * Host pinning compares hostnames only, so an https registry's metadata could point
   * the tarball at plain http on the same hostname. The transport rule is re-checked
   * against the tarball URL itself — metadata must not be able to downgrade the
   * credential onto cleartext.
   */
  it('withholds the credential from a plaintext http tarball on the registry hostname', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tarball = 'http://private.registry.test/private-pack/-/private-pack-1.0.0.tgz';
    await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
    });

    expect(seen.get(tarball)).toBeUndefined();
    warn.mockRestore();
  });

  it('withholds the credential from a tarball on a different port of the registry host', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tarball = 'https://private.registry.test:8443/private-pack/-/private-pack-1.0.0.tgz';
    await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
    });

    expect(seen.get(tarball)).toBeUndefined();
    warn.mockRestore();
  });

  it('never sends a bare env token to a tarball host outside the registry', async () => {
    process.env.NPM_TOKEN = 'env-token';
    process.env.NPM_CONFIG_REGISTRY = REGISTRY;
    const { seen, fn } = recordingFetch();
    globalThis.fetch = fn;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tarball = `${CDN}/private-pack-1.0.0.tgz`;
    await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
      allowExternalTarballHost: true,
    });

    expect(seen.get(tarball)).toBeUndefined();
    warn.mockRestore();
  });

  it('keeps no credential in the lockfile entry', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    const { fn } = recordingFetch();
    globalThis.fetch = fn;

    const tarball = `${REGISTRY}/private-pack/-/private-pack-1.0.0.tgz`;
    const entry = await installPackVersion(root, metadataFor(tarball), '1.0.0', {
      registryUrl: REGISTRY,
      skipSignatureVerification: true,
    });

    expect(entry).toEqual({ version: '1.0.0', resolved: tarball, integrity: TARBALL_INTEGRITY });
    expect(JSON.stringify(entry)).not.toContain('reg-token');
  });

  it('reports a 401 with actionable guidance and no credential echoed back', async () => {
    writeRootNpmrc('//private.registry.test/:_authToken=reg-token\n');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }) as unknown as typeof globalThis.fetch;

    await expect(fetchPackageMetadata('private-pack', REGISTRY, root)).rejects.toThrow(
      /denied access to "private-pack" \(HTTP 401\).*rejected it/s,
    );
    await expect(fetchPackageMetadata('private-pack', REGISTRY, root)).rejects.not.toThrow(/reg-token/);
  });
});

describe('redirect handling', () => {
  const originalFetch = globalThis.fetch;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `bluetemberg-redirect-${process.pid}.tgz`);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tmpFile, { force: true });
  });

  /**
   * `downloadTarball` relies on the platform `fetch` dropping `Authorization` when a
   * redirect crosses origins — that is what makes it safe to authenticate a download
   * that may be bounced to a signed CDN URL. Assert it against real HTTP servers so a
   * future switch to a custom HTTP client cannot regress it silently.
   */
  it('drops Authorization across a cross-origin redirect but keeps it same-origin', async () => {
    const seen: Record<string, string | undefined> = {};

    const target = createServer((req, res) => {
      seen.crossOrigin = req.headers.authorization;
      res.end(TARBALL_BYTES);
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    const targetPort = (target.address() as AddressInfo).port;

    const origin = createServer((req, res) => {
      if (req.url === '/same-origin-target') {
        seen.sameOrigin = req.headers.authorization;
        res.end(TARBALL_BYTES);
        return;
      }
      const location =
        req.url === '/to-same-origin' ? '/same-origin-target' : `http://127.0.0.1:${targetPort}/signed`;
      res.writeHead(302, { location });
      res.end();
    });
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
    const originPort = (origin.address() as AddressInfo).port;

    try {
      const headers = { Authorization: 'Bearer must-not-leak' };
      await downloadTarball(`http://127.0.0.1:${originPort}/to-same-origin`, tmpFile, { headers });
      await downloadTarball(`http://127.0.0.1:${originPort}/to-cross-origin`, tmpFile, { headers });
    } finally {
      origin.close();
      target.close();
    }

    expect(seen.sameOrigin).toBe('Bearer must-not-leak');
    expect(seen.crossOrigin).toBeUndefined();
  });
});
