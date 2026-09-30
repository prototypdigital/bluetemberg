import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectStacks, detectStacksFromManifests, packageForStack } from '../src/stacks/detect.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(root: string, deps: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: deps }));
}

function writeInstalled(root: string, pkg: string, version: string): void {
  const dir = join(root, 'node_modules', ...pkg.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version }));
}

describe('packageForStack', () => {
  it('maps known stacks and falls back to the name for unknown ones', () => {
    expect(packageForStack('nextjs')).toBe('next');
    expect(packageForStack('angular')).toBe('@angular/core');
    expect(packageForStack('payload')).toBe('payload');
    expect(packageForStack('some-custom-stack')).toBe('some-custom-stack');
  });
});

describe('detectStacks', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('declared pinned versions win (highest confidence)', () => {
    writeManifest(root, {});
    const d = detectStacks(root, { stacks: { payload: '3.4.1' } });
    expect(d.get('payload')).toEqual({ version: '3.4.1', confidence: 'declared', source: 'config' });
  });

  it('resolves exact version from node_modules (PM-agnostic)', () => {
    writeManifest(root, { next: '^15.0.0' });
    writeInstalled(root, 'next', '15.3.1');
    const d = detectStacks(root);
    expect(d.get('nextjs')).toEqual({ version: '15.3.1', confidence: 'exact', source: 'node_modules' });
  });

  it('falls back to package-lock.json (lockfileVersion 3)', () => {
    writeManifest(root, { payload: '^3.0.0' });
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/payload': { version: '3.4.1' } } }),
    );
    const d = detectStacks(root);
    expect(d.get('payload')).toEqual({ version: '3.4.1', confidence: 'exact', source: 'package-lock.json' });
  });

  it('falls back to a coerced manifest range (low confidence) when nothing is installed', () => {
    writeManifest(root, { '@angular/core': '^17.2.0' });
    const d = detectStacks(root);
    expect(d.get('angular')).toEqual({ version: '17.2.0', confidence: 'coerced', source: 'package.json' });
  });

  it('"auto" forces re-detection instead of using a declared pin', () => {
    writeManifest(root, { next: '^15.0.0' });
    writeInstalled(root, 'next', '15.3.1');
    const d = detectStacks(root, { stacks: { nextjs: 'auto' } });
    expect(d.get('nextjs')?.confidence).toBe('exact');
    expect(d.get('nextjs')?.version).toBe('15.3.1');
  });

  it('resolves a hoisted dependency from the workspace root node_modules (Node resolution)', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
    writeInstalled(root, 'react', '18.3.1');
    const web = join(root, 'packages', 'web');
    mkdirSync(web, { recursive: true });
    writeManifest(web, { react: '^18.0.0' });

    const d = detectStacks(web);
    expect(d.get('react')).toEqual({ version: '18.3.1', confidence: 'exact', source: '../../node_modules' });
  });

  it("prefers a package's own nested install over the hoisted one", () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
    writeInstalled(root, 'react', '18.3.1');
    const legacy = join(root, 'packages', 'legacy');
    mkdirSync(legacy, { recursive: true });
    writeManifest(legacy, { react: '^17.0.0' });
    writeInstalled(legacy, 'react', '17.0.2');

    expect(detectStacks(legacy).get('react')).toEqual({
      version: '17.0.2',
      confidence: 'exact',
      source: 'node_modules',
    });
  });

  it('resolves per-package versions from the workspace-root lockfile, nested entries first', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/react': { version: '18.3.1' },
          'packages/legacy/node_modules/react': { version: '17.0.2' },
        },
      }),
    );
    for (const pkg of ['web', 'legacy']) {
      mkdirSync(join(root, 'packages', pkg), { recursive: true });
      writeManifest(join(root, 'packages', pkg), { react: '*' });
    }

    const web = detectStacks(join(root, 'packages', 'web')).get('react');
    const legacy = detectStacks(join(root, 'packages', 'legacy')).get('react');
    expect(web).toEqual({ version: '18.3.1', confidence: 'exact', source: '../../package-lock.json' });
    expect(legacy).toEqual({ version: '17.0.2', confidence: 'exact', source: '../../package-lock.json' });
  });

  it('never climbs past the project when no repo/workspace boundary is above it', () => {
    // `root` has no .git / lockfile / workspaces marker, so an ancestor install is not trusted.
    writeInstalled(root, 'react', '18.3.1');
    const inner = join(root, 'inner');
    mkdirSync(inner, { recursive: true });
    writeManifest(inner, { react: '^17.0.0' });

    expect(detectStacks(inner).get('react')?.confidence).toBe('coerced');
  });

  it('omits stacks that are neither declared nor present', () => {
    writeManifest(root, { lodash: '^4.0.0' });
    const d = detectStacks(root);
    expect(d.size).toBe(0);
  });
});

describe('detectStacksFromManifests (remote path)', () => {
  it('resolves exact version from a lockfile object (no node_modules layer)', () => {
    const manifest = { dependencies: { next: '^15.0.0' } };
    const lock = { lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.1' } } };
    const d = detectStacksFromManifests(manifest, lock);
    expect(d.get('nextjs')).toEqual({ version: '15.3.1', confidence: 'exact', source: 'package-lock.json' });
  });

  it('handles lockfileVersion 1 shape', () => {
    const manifest = { dependencies: { payload: '^3.0.0' } };
    const lock = { lockfileVersion: 1, dependencies: { payload: { version: '3.4.1' } } };
    const d = detectStacksFromManifests(manifest, lock);
    expect(d.get('payload')).toEqual({ version: '3.4.1', confidence: 'exact', source: 'package-lock.json' });
  });

  it('coerces the manifest range when no lockfile is available', () => {
    const manifest = { devDependencies: { '@angular/core': '^17.2.0' } };
    const d = detectStacksFromManifests(manifest, null);
    expect(d.get('angular')).toEqual({ version: '17.2.0', confidence: 'coerced', source: 'package.json' });
  });

  it('declared config still wins over fetched manifests', () => {
    const manifest = { dependencies: { next: '^14.0.0' } };
    const d = detectStacksFromManifests(manifest, null, { stacks: { nextjs: '15.3.1' } });
    expect(d.get('nextjs')).toEqual({ version: '15.3.1', confidence: 'declared', source: 'config' });
  });

  it('matches detectStacks output for the same manifest+lock minus node_modules', () => {
    const manifest = { dependencies: { payload: '^3.0.0', next: '^15.0.0' } };
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/payload': { version: '3.4.1' },
        'node_modules/next': { version: '15.3.1' },
      },
    };
    const d = detectStacksFromManifests(manifest, lock);
    expect(d.get('payload')?.version).toBe('3.4.1');
    expect(d.get('nextjs')?.version).toBe('15.3.1');
    expect(d.size).toBe(2);
  });

  it('returns an empty map when no known stack is present', () => {
    const d = detectStacksFromManifests({ dependencies: { lodash: '^4.0.0' } }, null);
    expect(d.size).toBe(0);
  });
});
