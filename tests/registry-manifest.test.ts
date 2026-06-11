import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readManifest,
  writeManifest,
  readLockfile,
  writeLockfile,
  hasPackages,
  hasLegacyManifestFiles,
  migrateLegacyManifests,
  manifestPath,
  lockfilePath,
} from '../src/registry/manifest.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('manifest (llm/packages.json)', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty manifest when file does not exist', () => {
    const m = readManifest(root);
    expect(m).toEqual({ packages: {} });
  });

  it('reads a valid manifest', () => {
    writeFileSync(
      manifestPath(root),
      JSON.stringify({
        registry: 'https://custom.registry.io',
        packages: { 'my-rules': '^1.0.0' },
      }),
    );

    const m = readManifest(root);
    expect(m.registry).toBe('https://custom.registry.io');
    expect(m.packages['my-rules']).toBe('^1.0.0');
  });

  it('writes and reads back a manifest', () => {
    writeManifest(root, {
      packages: { '@scope/pack': '~2.0.0', other: 'latest' },
    });

    const m = readManifest(root);
    expect(m.packages).toEqual({ '@scope/pack': '~2.0.0', other: 'latest' });
  });

  it('throws on invalid manifest (not an object)', () => {
    writeFileSync(manifestPath(root), '"bad"');
    expect(() => readManifest(root)).toThrow('expected an object');
  });

  it('throws on invalid manifest (registry not string)', () => {
    writeFileSync(manifestPath(root), JSON.stringify({ registry: 123, packages: {} }));
    expect(() => readManifest(root)).toThrow('"registry" must be a string');
  });

  it('throws on invalid manifest (packages not object)', () => {
    writeFileSync(manifestPath(root), JSON.stringify({ packages: 'bad' }));
    expect(() => readManifest(root)).toThrow('"packages" must be an object');
  });

  it('throws on invalid manifest (package range not string)', () => {
    writeFileSync(manifestPath(root), JSON.stringify({ packages: { bad: 123 } }));
    expect(() => readManifest(root)).toThrow('must be a string (semver range)');
  });

  it('respects custom source directory', () => {
    mkdirSync(join(root, 'custom'), { recursive: true });
    writeManifest(root, { packages: { foo: '^1.0.0' } }, 'custom');

    const m = readManifest(root, 'custom');
    expect(m.packages.foo).toBe('^1.0.0');
    expect(manifestPath(root, 'custom')).toBe(join(root, 'custom', 'packages.json'));
  });
});

describe('legacy manifest migration', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('readManifest merges legacy kind-split manifests in memory', () => {
    writeFileSync(
      join(root, 'llm', 'rule-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-rules-git': '^0.1.0' } }),
    );
    writeFileSync(
      join(root, 'llm', 'agent-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-agents-test-specialist': '^0.1.0' } }),
    );
    writeFileSync(
      join(root, 'llm', 'skill-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-skills-patterns': '^0.1.0' } }),
    );

    const m = readManifest(root);
    expect(m.packages['bluetemberg-rules-git']).toBe('^0.1.0');
    expect(m.packages['bluetemberg-agents-test-specialist']).toBe('^0.1.0');
    expect(m.packages['bluetemberg-skills-patterns']).toBe('^0.1.0');
    // Read-only: legacy files stay on disk until migration.
    expect(existsSync(join(root, 'llm', 'rule-packages.json'))).toBe(true);
  });

  it('unified manifest entries win over legacy entries on conflict', () => {
    writeManifest(root, { packages: { 'bluetemberg-rules-git': '^2.0.0' } });
    writeFileSync(
      join(root, 'llm', 'rule-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-rules-git': '^0.1.0' } }),
    );

    const m = readManifest(root);
    expect(m.packages['bluetemberg-rules-git']).toBe('^2.0.0');
  });

  it('readLockfile merges the legacy lockfile in memory', () => {
    writeFileSync(
      join(root, 'llm', 'rule-packages-lock.json'),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { 'pack-a': { version: '1.0.0', resolved: 'https://x/a.tgz', integrity: 'sha512-a' } },
      }),
    );

    const lock = readLockfile(root);
    expect(lock.packages['pack-a'].version).toBe('1.0.0');
  });

  it('migrateLegacyManifests consolidates and deletes legacy files', () => {
    writeFileSync(
      join(root, 'llm', 'rule-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-rules-git': '^0.1.0' } }),
    );
    writeFileSync(
      join(root, 'llm', 'agent-packages.json'),
      JSON.stringify({ packages: { 'bluetemberg-agents-test-specialist': '^0.1.0' } }),
    );
    writeFileSync(
      join(root, 'llm', 'rule-packages-lock.json'),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { 'pack-a': { version: '1.0.0', resolved: 'https://x/a.tgz', integrity: 'sha512-a' } },
      }),
    );

    const removed = migrateLegacyManifests(root);

    expect(removed).toEqual(['rule-packages.json', 'agent-packages.json', 'rule-packages-lock.json']);
    expect(existsSync(join(root, 'llm', 'rule-packages.json'))).toBe(false);
    expect(existsSync(join(root, 'llm', 'agent-packages.json'))).toBe(false);
    expect(existsSync(join(root, 'llm', 'rule-packages-lock.json'))).toBe(false);

    const m = readManifest(root);
    expect(m.packages['bluetemberg-rules-git']).toBe('^0.1.0');
    expect(m.packages['bluetemberg-agents-test-specialist']).toBe('^0.1.0');
    const lock = readLockfile(root);
    expect(lock.packages['pack-a'].version).toBe('1.0.0');
  });

  it('migrateLegacyManifests is a no-op when no legacy files exist', () => {
    writeManifest(root, { packages: { foo: '^1.0.0' } });

    const removed = migrateLegacyManifests(root);

    expect(removed).toEqual([]);
    expect(readManifest(root).packages.foo).toBe('^1.0.0');
  });

  it('hasLegacyManifestFiles detects any legacy file', () => {
    expect(hasLegacyManifestFiles(root)).toBe(false);

    writeFileSync(join(root, 'llm', 'skill-packages.json'), JSON.stringify({ packages: {} }));
    expect(hasLegacyManifestFiles(root)).toBe(true);
  });
});

describe('lockfile (llm/packages-lock.json)', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty lockfile when file does not exist', () => {
    const lock = readLockfile(root);
    expect(lock).toEqual({ lockfileVersion: 1, packages: {} });
  });

  it('reads a valid lockfile', () => {
    writeFileSync(
      lockfilePath(root),
      JSON.stringify({
        lockfileVersion: 1,
        packages: {
          'my-rules': {
            version: '1.2.3',
            resolved: 'https://registry.npmjs.org/my-rules/-/my-rules-1.2.3.tgz',
            integrity: 'sha512-abc123',
          },
        },
      }),
    );

    const lock = readLockfile(root);
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.packages['my-rules'].version).toBe('1.2.3');
    expect(lock.packages['my-rules'].integrity).toBe('sha512-abc123');
  });

  it('writes and reads back a lockfile', () => {
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': {
          version: '2.0.0',
          resolved: 'https://example.com/a.tgz',
          integrity: 'sha512-xyz',
        },
      },
    });

    const lock = readLockfile(root);
    expect(lock.packages['pack-a'].version).toBe('2.0.0');
  });

  it('throws on invalid lockfile version', () => {
    writeFileSync(lockfilePath(root), JSON.stringify({ lockfileVersion: 2, packages: {} }));
    expect(() => readLockfile(root)).toThrow('unsupported lockfileVersion');
  });

  it('throws on invalid lockfile (packages not object)', () => {
    writeFileSync(lockfilePath(root), JSON.stringify({ lockfileVersion: 1, packages: 'bad' }));
    expect(() => readLockfile(root)).toThrow('"packages" must be an object');
  });

  it('throws on invalid lock entry (missing version)', () => {
    writeFileSync(
      lockfilePath(root),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { bad: { resolved: 'x', integrity: 'y' } },
      }),
    );
    expect(() => readLockfile(root)).toThrow('version must be a string');
  });

  it('throws on invalid lock entry (missing resolved)', () => {
    writeFileSync(
      lockfilePath(root),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { bad: { version: '1.0.0', integrity: 'y' } },
      }),
    );
    expect(() => readLockfile(root)).toThrow('resolved must be a string');
  });

  it('throws on invalid lock entry (missing integrity)', () => {
    writeFileSync(
      lockfilePath(root),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { bad: { version: '1.0.0', resolved: 'x' } },
      }),
    );
    expect(() => readLockfile(root)).toThrow('integrity must be a string');
  });

  it('respects custom source directory', () => {
    mkdirSync(join(root, 'custom'), { recursive: true });
    writeLockfile(
      root,
      {
        lockfileVersion: 1,
        packages: { foo: { version: '1.0.0', resolved: 'x', integrity: 'y' } },
      },
      'custom',
    );

    const lock = readLockfile(root, 'custom');
    expect(lock.packages.foo.version).toBe('1.0.0');
    expect(lockfilePath(root, 'custom')).toBe(join(root, 'custom', 'packages-lock.json'));
  });
});

describe('hasPackages', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false when no manifest exists', () => {
    expect(hasPackages(root)).toBe(false);
  });

  it('returns false when manifest has empty packages', () => {
    writeManifest(root, { packages: {} });
    expect(hasPackages(root)).toBe(false);
  });

  it('returns true when manifest has packages', () => {
    writeManifest(root, { packages: { 'my-rules': '^1.0.0' } });
    expect(hasPackages(root)).toBe(true);
  });
});
