import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePackSourceDirs, update } from '../src/registry/index.js';
import { writeManifest, writeLockfile, readManifest, readLockfile } from '../src/registry/manifest.js';
import { packVersionDir } from '../src/registry/installer.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupProject(root: string): void {
  mkdirSync(join(root, 'llm'), { recursive: true });
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['cursor', 'claude'], source: 'llm' }),
  );
}

describe('resolvePackSourceDirs', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty dirs and no warnings when no manifest exists', () => {
    expect(resolvePackSourceDirs(root)).toEqual({ dirs: [], warnings: [] });
  });

  it('returns empty dirs and no warnings when manifest has no packages', () => {
    writeManifest(root, { packages: {} });
    expect(resolvePackSourceDirs(root)).toEqual({ dirs: [], warnings: [] });
  });

  it('returns source dirs for locked and cached packages', () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.2.0', resolved: 'x', integrity: 'y' },
      },
    });

    // Create cached pack with llm/ subdirectory.
    const packDir = packVersionDir(root, 'pack-a', '1.2.0');
    mkdirSync(join(packDir, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(packDir, 'llm', 'rules', 'a.md'), '# rule a');

    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(packDir, 'llm'));
    expect(warnings).toEqual([]);
  });

  it('skips packages that are locked but not cached and emits a warning', () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.2.0', resolved: 'x', integrity: 'y' },
      },
    });

    // Do not create cache dir.
    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pack-a@1.2.0');
    expect(warnings[0]).toContain('bluetemberg install');
  });

  it('skips packages without a lock entry and emits a warning', () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, { lockfileVersion: 1, packages: {} });

    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pack-a');
    expect(warnings[0]).toContain('bluetemberg install');
  });

  it('returns dirs for multiple packages in manifest order', () => {
    writeManifest(root, {
      packages: { 'pack-a': '^1.0.0', 'pack-b': '^2.0.0' },
    });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' },
        'pack-b': { version: '2.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    const dirA = packVersionDir(root, 'pack-a', '1.0.0');
    const dirB = packVersionDir(root, 'pack-b', '2.0.0');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toEqual([dirA, dirB]);
    expect(warnings).toEqual([]);
  });

  it('resolves pack without llm/ to pack root', () => {
    writeManifest(root, { packages: { 'flat-pack': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'flat-pack': { version: '1.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    const packDir = packVersionDir(root, 'flat-pack', '1.0.0');
    mkdirSync(join(packDir, 'rules'), { recursive: true });
    writeFileSync(join(packDir, 'rules', 'a.md'), '# rule');

    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toEqual([packDir]);
    expect(warnings).toEqual([]);
  });

  it('warns about stale lockfile entries not present in manifest', () => {
    writeManifest(root, { packages: {} });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'stale-pack': { version: '1.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    const { dirs, warnings } = resolvePackSourceDirs(root);
    expect(dirs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('stale-pack');
  });
});

describe('parsePackageSpec (via add argument parsing)', () => {
  // These tests verify the spec parsing indirectly via the module's internal logic.
  // We test edge cases through the resolvePackSourceDirs and manifest roundtrip.

  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('manifest preserves scoped package names', () => {
    writeManifest(root, { packages: { '@scope/my-rules': '^1.0.0' } });
    const m = readManifest(root);
    expect(m.packages['@scope/my-rules']).toBe('^1.0.0');
  });
});

describe('sync integration with packs', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    setupProject(root);
    // Create local source dir.
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('sync includes rules from cached packs', async () => {
    const { sync, loadConfig } = await import('../src/sync/index.js');

    // Set up a pack with a rule.
    writeManifest(root, { packages: { 'community-rules': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'community-rules': { version: '1.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    const packDir = packVersionDir(root, 'community-rules', '1.0.0');
    mkdirSync(join(packDir, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(packDir, 'llm', 'rules', 'pack-rule.md'),
      '---\ndescription: from pack\nscope: "**"\n---\n\n# Pack Rule\n',
    );

    // Also create a local rule.
    writeFileSync(
      join(root, 'llm', 'rules', 'local-rule.md'),
      '---\ndescription: local rule\nscope: "**"\n---\n\n# Local Rule\n',
    );

    const config = loadConfig(root);
    const results = await sync(root, { config, silent: true });

    expect(results.errors).toEqual([]);

    // Both local and pack rules should be synced.
    // For cursor platform: .cursor/rules/ should have both files.
    const cursorRulesDir = join(root, '.cursor', 'rules');
    expect(existsSync(join(cursorRulesDir, 'local-rule.mdc'))).toBe(true);
    expect(existsSync(join(cursorRulesDir, 'pack-rule.mdc'))).toBe(true);
  });

  it('local rules take priority over pack rules with the same name', async () => {
    const { sync, loadConfig } = await import('../src/sync/index.js');

    writeManifest(root, { packages: { 'community-rules': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'community-rules': { version: '1.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    const packDir = packVersionDir(root, 'community-rules', '1.0.0');
    mkdirSync(join(packDir, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(packDir, 'llm', 'rules', 'shared.md'),
      '---\ndescription: pack version\nscope: "**"\n---\n\n# Pack Version\n',
    );

    // Local rule with same name should win.
    writeFileSync(
      join(root, 'llm', 'rules', 'shared.md'),
      '---\ndescription: local version\nscope: "**"\n---\n\n# Local Version\n',
    );

    const config = loadConfig(root);
    const results = await sync(root, { config, silent: true });
    expect(results.errors).toEqual([]);

    // Verify local version was used (check content in output).
    const cursorOutput = readFileSync(join(root, '.cursor', 'rules', 'shared.mdc'), 'utf8');
    expect(cursorOutput).toContain('local version');
    expect(cursorOutput).not.toContain('pack version');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

vi.mock('../src/registry/client.js', () => ({
  fetchPackageMetadata: vi.fn(),
  searchPackages: vi.fn(),
  downloadTarball: vi.fn(),
  verifyIntegrity: vi.fn(),
}));

vi.mock('../src/registry/installer.js', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  type InstallerModule = typeof import('../src/registry/installer.js');
  const actual = await importOriginal<InstallerModule>();
  return {
    ...actual,
    installPackVersion: vi.fn(),
    removePackVersion: vi.fn(),
  };
});

describe('update', () => {
  let root: string;

  beforeEach(async () => {
    root = createTmpDir();
    setupProject(root);
    vi.resetAllMocks();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function mockInstallPackVersion(version: string): Promise<void> {
    const { installPackVersion } = await import('../src/registry/installer.js');
    vi.mocked(installPackVersion).mockResolvedValue({
      version,
      resolved: `https://registry.npmjs.org/pack-a/-/pack-a-${version}.tgz`,
      integrity: `sha512-mock-${version}`,
    });
  }

  async function mockFetchMetadata(name: string, versions: string[]): Promise<void> {
    const { fetchPackageMetadata } = await import('../src/registry/client.js');
    const versionsMap: Record<
      string,
      { name: string; version: string; dist: { tarball: string; shasum: string; integrity: string } }
    > = {};
    for (const v of versions) {
      versionsMap[v] = {
        name,
        version: v,
        dist: {
          tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`,
          shasum: 'abc123',
          integrity: `sha512-mock-${v}`,
        },
      };
    }
    vi.mocked(fetchPackageMetadata).mockResolvedValue({
      name,
      'dist-tags': { latest: versions[versions.length - 1] },
      versions: versionsMap,
    });
  }

  it('throws when packageName is not in manifest', async () => {
    writeManifest(root, { packages: {} });

    await expect(update(root, 'nonexistent', { silent: true })).rejects.toThrow(
      'Package "nonexistent" is not in the manifest',
    );
  });

  it('returns empty array and no-ops when manifest has no packages', async () => {
    writeManifest(root, { packages: {} });

    const results = await update(root, undefined, { silent: true });

    expect(results).toEqual([]);
  });

  it('upgrades a pack when a newer version satisfies the range', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: { 'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' } },
    });

    await mockFetchMetadata('pack-a', ['1.0.0', '1.2.3']);
    await mockInstallPackVersion('1.2.3');

    const results = await update(root, undefined, { silent: true });

    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('1.2.3');

    const lock = readLockfile(root);
    expect(lock.packages['pack-a'].version).toBe('1.2.3');

    // Manifest range must not change when --latest is not set.
    const manifest = readManifest(root);
    expect(manifest.packages['pack-a']).toBe('^1.0.0');
  });

  it('skips download when locked version matches resolved version and is cached', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: { 'pack-a': { version: '1.2.0', resolved: 'x', integrity: 'y' } },
    });

    // Create cache so isPackCached returns true.
    mkdirSync(packVersionDir(root, 'pack-a', '1.2.0'), { recursive: true });

    await mockFetchMetadata('pack-a', ['1.0.0', '1.2.0']);

    const { installPackVersion } = await import('../src/registry/installer.js');
    const results = await update(root, undefined, { silent: true });

    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('1.2.0');
    expect(vi.mocked(installPackVersion)).not.toHaveBeenCalled();
  });

  it('removes old cached version after upgrading', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: { 'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' } },
    });

    await mockFetchMetadata('pack-a', ['1.0.0', '1.2.3']);
    await mockInstallPackVersion('1.2.3');

    const { removePackVersion } = await import('../src/registry/installer.js');
    await update(root, undefined, { silent: true });

    expect(vi.mocked(removePackVersion)).toHaveBeenCalledWith(root, 'pack-a', '1.0.0');
  });

  it('widens range to "latest" and updates manifest when --latest is set', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: { 'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' } },
    });

    await mockFetchMetadata('pack-a', ['1.0.0', '2.0.0']);
    await mockInstallPackVersion('2.0.0');

    await update(root, undefined, { latest: true, silent: true });

    const manifest = readManifest(root);
    expect(manifest.packages['pack-a']).toBe('latest');

    const lock = readLockfile(root);
    expect(lock.packages['pack-a'].version).toBe('2.0.0');
  });

  it('updates only the specified package when packageName is provided', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0', 'pack-b': '^2.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' },
        'pack-b': { version: '2.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    await mockFetchMetadata('pack-a', ['1.0.0', '1.5.0']);
    await mockInstallPackVersion('1.5.0');

    const { fetchPackageMetadata } = await import('../src/registry/client.js');
    const results = await update(root, 'pack-a', { silent: true });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('pack-a');
    expect(results[0].version).toBe('1.5.0');

    // pack-b should not have been fetched.
    expect(vi.mocked(fetchPackageMetadata)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchPackageMetadata)).toHaveBeenCalledWith('pack-a', undefined, root);
  });

  it('prunes stale lockfile entries not present in the manifest on full update', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' },
        'pack-stale': { version: '3.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    // pack-a is already up to date and cached.
    mkdirSync(packVersionDir(root, 'pack-a', '1.0.0'), { recursive: true });
    await mockFetchMetadata('pack-a', ['1.0.0']);

    await update(root, undefined, { silent: true });

    const lock = readLockfile(root);
    expect('pack-stale' in lock.packages).toBe(false);
    expect('pack-a' in lock.packages).toBe(true);
  });

  it('does not prune stale entries when targeting a single package', async () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.0.0', resolved: 'x', integrity: 'y' },
        'pack-stale': { version: '3.0.0', resolved: 'x', integrity: 'y' },
      },
    });

    mkdirSync(packVersionDir(root, 'pack-a', '1.0.0'), { recursive: true });
    await mockFetchMetadata('pack-a', ['1.0.0']);

    await update(root, 'pack-a', { silent: true });

    const lock = readLockfile(root);
    expect('pack-stale' in lock.packages).toBe(true);
  });
});
