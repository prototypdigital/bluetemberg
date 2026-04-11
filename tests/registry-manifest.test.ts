import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readManifest,
  writeManifest,
  readLockfile,
  writeLockfile,
  hasPackages,
  manifestPath,
  lockfilePath,
} from '../src/registry/manifest.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('manifest (llm/rule-packages.json)', () => {
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
    expect(manifestPath(root, 'custom')).toBe(join(root, 'custom', 'rule-packages.json'));
  });
});

describe('lockfile (llm/rule-packages-lock.json)', () => {
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
    expect(lockfilePath(root, 'custom')).toBe(join(root, 'custom', 'rule-packages-lock.json'));
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
