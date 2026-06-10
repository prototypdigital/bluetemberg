import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readSourceManifest,
  writeSourceManifest,
  readSourceLock,
  writeSourceLock,
  hasSources,
  sourceManifestPath,
  sourceLockfilePath,
} from '../src/sources/manifest.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-srcmanifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('source manifest (llm/rule-sources.json)', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty manifest when file does not exist', () => {
    expect(readSourceManifest(root)).toEqual({ sources: {} });
  });

  it('writes and reads back a github source spec', () => {
    writeSourceManifest(root, {
      sources: {
        'github:owner/repo:rules': {
          type: 'github',
          owner: 'owner',
          repo: 'repo',
          ref: 'HEAD',
          path: 'rules',
        },
      },
    });
    const m = readSourceManifest(root);
    expect(m.sources['github:owner/repo:rules']).toEqual({
      type: 'github',
      owner: 'owner',
      repo: 'repo',
      ref: 'HEAD',
      path: 'rules',
    });
  });

  it('throws when sources is not an object', () => {
    writeFileSync(sourceManifestPath(root), JSON.stringify({ sources: 'bad' }));
    expect(() => readSourceManifest(root)).toThrow('"sources" must be an object');
  });

  it('throws on an unknown source type', () => {
    writeFileSync(sourceManifestPath(root), JSON.stringify({ sources: { x: { type: 'svn' } } }));
    expect(() => readSourceManifest(root)).toThrow('type must be one of');
  });

  it('throws when a github field is missing', () => {
    writeFileSync(
      sourceManifestPath(root),
      JSON.stringify({ sources: { x: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD' } } }),
    );
    expect(() => readSourceManifest(root)).toThrow('.path must be a string');
  });

  it('rejects a github path containing ".." traversal', () => {
    writeFileSync(
      sourceManifestPath(root),
      JSON.stringify({
        sources: { x: { type: 'github', owner: 'o', repo: 'r', ref: 'HEAD', path: '../etc' } },
      }),
    );
    expect(() => readSourceManifest(root)).toThrow('must not contain ".." segments');
  });

  it('respects a custom source directory', () => {
    mkdirSync(join(root, 'custom'), { recursive: true });
    writeSourceManifest(
      root,
      { sources: { 'prpm:x': { type: 'prpm', name: 'x', range: 'latest' } } },
      'custom',
    );
    expect(readSourceManifest(root, 'custom').sources['prpm:x']).toEqual({
      type: 'prpm',
      name: 'x',
      range: 'latest',
    });
    expect(sourceManifestPath(root, 'custom')).toBe(join(root, 'custom', 'rule-sources.json'));
  });
});

describe('source lockfile (llm/rule-sources-lock.json)', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty lockfile when file does not exist', () => {
    expect(readSourceLock(root)).toEqual({ lockfileVersion: 1, sources: {} });
  });

  it('writes and reads back a lock entry', () => {
    writeSourceLock(root, {
      lockfileVersion: 1,
      sources: {
        'github:owner/repo': {
          type: 'github',
          ref: 'abc123',
          resolved: 'https://x/tar.gz/abc123',
          integrity: 'sha512-z',
        },
      },
    });
    expect(readSourceLock(root).sources['github:owner/repo'].ref).toBe('abc123');
  });

  it('throws on an unsupported lockfileVersion', () => {
    writeFileSync(sourceLockfilePath(root), JSON.stringify({ lockfileVersion: 2, sources: {} }));
    expect(() => readSourceLock(root)).toThrow('unsupported lockfileVersion');
  });

  it('throws when a lock entry is missing integrity', () => {
    writeFileSync(
      sourceLockfilePath(root),
      JSON.stringify({ lockfileVersion: 1, sources: { x: { type: 'github', ref: 'a', resolved: 'b' } } }),
    );
    expect(() => readSourceLock(root)).toThrow('.integrity must be a string');
  });
});

describe('hasSources', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is false with no manifest and true once a source is added', () => {
    expect(hasSources(root)).toBe(false);
    writeSourceManifest(root, { sources: { 'prpm:x': { type: 'prpm', name: 'x', range: 'latest' } } });
    expect(hasSources(root)).toBe(true);
  });
});
