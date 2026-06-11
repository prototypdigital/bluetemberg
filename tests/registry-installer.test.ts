import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  packsCacheDir,
  packVersionDir,
  isPackCached,
  resolveVersion,
  resolvePackSourceDir,
  removePackVersion,
} from '../src/registry/installer.js';
import type { NpmPackageMetadata } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-installer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockMetadata(name: string, versions: string[]): NpmPackageMetadata {
  const versionsMap: NpmPackageMetadata['versions'] = {};
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

  return {
    name,
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: versionsMap,
  };
}

describe('packsCacheDir / packVersionDir', () => {
  it('returns correct cache directory', () => {
    expect(packsCacheDir('/project')).toBe('/project/.bluetemberg/packs');
  });

  it('returns correct version directory for unscoped package', () => {
    expect(packVersionDir('/project', 'my-rules', '1.2.3')).toBe(
      '/project/.bluetemberg/packs/my-rules/1.2.3',
    );
  });

  it('returns correct version directory for scoped package', () => {
    expect(packVersionDir('/project', '@scope/rules', '2.0.0')).toBe(
      '/project/.bluetemberg/packs/@scope/rules/2.0.0',
    );
  });

  it('throws when a traversal name would escape the pack cache', () => {
    expect(() => packVersionDir('/project', '../../../../tmp/evil', '1.0.0')).toThrow(
      /outside the pack cache/,
    );
  });

  it('throws when the version escapes the pack cache', () => {
    expect(() => packVersionDir('/project', 'my-rules', '../../etc')).toThrow(/outside the pack cache/);
  });
});

describe('isPackCached', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false when not cached', () => {
    expect(isPackCached(root, 'my-rules', '1.0.0')).toBe(false);
  });

  it('returns true when cached', () => {
    const dir = packVersionDir(root, 'my-rules', '1.0.0');
    mkdirSync(dir, { recursive: true });
    expect(isPackCached(root, 'my-rules', '1.0.0')).toBe(true);
  });
});

describe('resolveVersion', () => {
  const metadata = createMockMetadata('test-pack', ['1.0.0', '1.1.0', '1.2.0', '2.0.0']);

  it('resolves "latest" to the latest dist-tag', () => {
    expect(resolveVersion(metadata, 'latest')).toBe('2.0.0');
  });

  it('resolves exact version', () => {
    expect(resolveVersion(metadata, '1.1.0')).toBe('1.1.0');
  });

  it('resolves caret range', () => {
    expect(resolveVersion(metadata, '^1.0.0')).toBe('1.2.0');
  });

  it('resolves tilde range', () => {
    expect(resolveVersion(metadata, '~1.0.0')).toBe('1.0.0');
  });

  it('resolves range with major constraint', () => {
    expect(resolveVersion(metadata, '>=1.0.0 <2.0.0')).toBe('1.2.0');
  });

  it('throws when no version satisfies the range', () => {
    expect(() => resolveVersion(metadata, '^3.0.0')).toThrow('No version of "test-pack" satisfies range');
  });

  it('throws when metadata has no latest dist-tag and range is "latest"', () => {
    const noLatest: NpmPackageMetadata = {
      name: 'no-latest',
      'dist-tags': {},
      versions: {},
    };
    expect(() => resolveVersion(noLatest, 'latest')).toThrow('no "latest" dist-tag');
  });

  it('resolves named dist-tags', () => {
    const withTags: NpmPackageMetadata = {
      ...metadata,
      'dist-tags': { latest: '2.0.0', beta: '3.0.0-beta.1' },
      versions: {
        ...metadata.versions,
        '3.0.0-beta.1': {
          name: 'test-pack',
          version: '3.0.0-beta.1',
          dist: { tarball: 'x', shasum: 'y' },
        },
      },
    };
    expect(resolveVersion(withTags, 'beta')).toBe('3.0.0-beta.1');
  });
});

describe('resolvePackSourceDir', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when pack is not cached', () => {
    expect(resolvePackSourceDir(root, 'missing', '1.0.0')).toBeNull();
  });

  it('returns llm/ subdirectory when present', () => {
    const dir = packVersionDir(root, 'my-rules', '1.0.0');
    mkdirSync(join(dir, 'llm'), { recursive: true });

    expect(resolvePackSourceDir(root, 'my-rules', '1.0.0')).toBe(join(dir, 'llm'));
  });

  it('falls back to pack root when no llm/ subdirectory', () => {
    const dir = packVersionDir(root, 'my-rules', '1.0.0');
    mkdirSync(dir, { recursive: true });

    expect(resolvePackSourceDir(root, 'my-rules', '1.0.0')).toBe(dir);
  });
});

describe('removePackVersion', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('removes a cached pack version', () => {
    const dir = packVersionDir(root, 'my-rules', '1.0.0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'test.txt'), 'hello');

    removePackVersion(root, 'my-rules', '1.0.0');
    expect(existsSync(dir)).toBe(false);
  });

  it('cleans up empty parent directory', () => {
    const dir = packVersionDir(root, 'my-rules', '1.0.0');
    mkdirSync(dir, { recursive: true });

    removePackVersion(root, 'my-rules', '1.0.0');
    expect(existsSync(join(packsCacheDir(root), 'my-rules'))).toBe(false);
  });

  it('preserves parent directory if other versions exist', () => {
    const v1 = packVersionDir(root, 'my-rules', '1.0.0');
    const v2 = packVersionDir(root, 'my-rules', '2.0.0');
    mkdirSync(v1, { recursive: true });
    mkdirSync(v2, { recursive: true });

    removePackVersion(root, 'my-rules', '1.0.0');
    expect(existsSync(v1)).toBe(false);
    expect(existsSync(v2)).toBe(true);
  });

  it('is a no-op when the pack is not cached', () => {
    expect(() => removePackVersion(root, 'nonexistent', '1.0.0')).not.toThrow();
  });
});
