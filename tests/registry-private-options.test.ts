/**
 * Reachability of the private-distribution escape hatches.
 *
 * `installPackVersion` has honoured `skipSignatureVerification` and
 * `allowExternalTarballHost` for a while, but nothing on the install path passed them —
 * so the options existed and could not be used. These tests pin the wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/registry/client.js', () => ({
  fetchPackageMetadata: vi.fn(),
  searchPackages: vi.fn(),
  downloadTarball: vi.fn(),
  verifyIntegrity: vi.fn(),
  fetchRegistryKeys: vi.fn(),
  verifyRegistrySignature: vi.fn(),
  computeFileIntegrity: vi.fn(),
  DEFAULT_REGISTRY: 'https://registry.npmjs.org',
}));

vi.mock('../src/registry/installer.js', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  type InstallerModule = typeof import('../src/registry/installer.js');
  const actual = await importOriginal<InstallerModule>();
  return { ...actual, installPackVersion: vi.fn(), removePackVersion: vi.fn() };
});

import { add, install, search, update } from '../src/registry/index.js';
import { fetchPackageMetadata, searchPackages } from '../src/registry/client.js';
import { installPackVersion } from '../src/registry/installer.js';
import { writeManifest, writeLockfile } from '../src/registry/manifest.js';
import type { NpmPackageMetadata } from '../src/types.js';

const REGISTRY = 'https://private.registry.test';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-private-opts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'llm'), { recursive: true });
  writeFileSync(
    join(dir, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['cursor'], source: 'llm' }),
  );
  return dir;
}

function metadata(): NpmPackageMetadata {
  return {
    name: 'private-pack',
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name: 'private-pack',
        version: '1.0.0',
        dist: {
          tarball: `${REGISTRY}/private-pack/-/private-pack-1.0.0.tgz`,
          integrity: 'sha512-x',
          shasum: 'abc',
        },
      },
    },
  } as unknown as NpmPackageMetadata;
}

/** Options every caller should be forwarding to the installer. */
const ESCAPE_HATCHES = {
  skipSignatureVerification: true,
  allowExternalTarballHost: true,
};

describe('install-path escape hatches reach installPackVersion', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    vi.resetAllMocks();
    vi.mocked(fetchPackageMetadata).mockResolvedValue(metadata());
    vi.mocked(installPackVersion).mockResolvedValue({
      version: '1.0.0',
      resolved: `${REGISTRY}/private-pack/-/private-pack-1.0.0.tgz`,
      integrity: 'sha512-x',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('add forwards both options', async () => {
    await add(root, 'private-pack', { silent: true, ...ESCAPE_HATCHES });

    expect(installPackVersion).toHaveBeenCalledWith(
      root,
      expect.anything(),
      '1.0.0',
      expect.objectContaining(ESCAPE_HATCHES),
    );
  });

  it('install forwards both options', async () => {
    writeManifest(root, { registry: REGISTRY, packages: { 'private-pack': '^1.0.0' } }, 'llm');
    writeLockfile(root, { lockfileVersion: 1, packages: {} }, 'llm');

    await install(root, { silent: true, ...ESCAPE_HATCHES });

    expect(installPackVersion).toHaveBeenCalledWith(
      root,
      expect.anything(),
      '1.0.0',
      expect.objectContaining({ registryUrl: REGISTRY, ...ESCAPE_HATCHES }),
    );
  });

  it('update forwards both options', async () => {
    writeManifest(root, { registry: REGISTRY, packages: { 'private-pack': '^1.0.0' } }, 'llm');
    writeLockfile(
      root,
      {
        lockfileVersion: 1,
        packages: {
          'private-pack': { version: '0.9.0', resolved: `${REGISTRY}/x.tgz`, integrity: 'sha512-old' },
        },
      },
      'llm',
    );

    await update(root, 'private-pack', { silent: true, ...ESCAPE_HATCHES });

    expect(installPackVersion).toHaveBeenCalledWith(
      root,
      expect.anything(),
      '1.0.0',
      expect.objectContaining({ registryUrl: REGISTRY, ...ESCAPE_HATCHES }),
    );
  });

  it('leaves both options unset when the caller does not opt in', async () => {
    writeManifest(root, { registry: REGISTRY, packages: { 'private-pack': '^1.0.0' } }, 'llm');
    writeLockfile(root, { lockfileVersion: 1, packages: {} }, 'llm');

    await install(root, { silent: true });

    expect(installPackVersion).toHaveBeenCalledWith(
      root,
      expect.anything(),
      '1.0.0',
      expect.objectContaining({
        skipSignatureVerification: undefined,
        allowExternalTarballHost: undefined,
      }),
    );
  });
});

/**
 * `search` used to call the client with no registry, so it always hit npmjs.org — the
 * auth applied inside `searchPackages` was unreachable for a private registry, and
 * discovery there was impossible. Same dead-option shape as the escape hatches above.
 */
describe('search reaches the configured registry', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    vi.resetAllMocks();
    vi.mocked(searchPackages).mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes the manifest registry and root through', async () => {
    writeManifest(root, { registry: REGISTRY, packages: {} });

    await search('rules', { silent: true, root });

    expect(searchPackages).toHaveBeenCalledWith('rules', {
      limit: undefined,
      registryUrl: REGISTRY,
      root,
    });
  });

  it('leaves the registry undefined when the manifest configures none', async () => {
    writeManifest(root, { packages: {} });

    await search('rules', { silent: true, root });

    expect(searchPackages).toHaveBeenCalledWith(
      'rules',
      expect.objectContaining({ registryUrl: undefined, root }),
    );
  });
});
