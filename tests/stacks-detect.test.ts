import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectStacks, packageForStack } from '../src/stacks/detect.js';

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

  it('omits stacks that are neither declared nor present', () => {
    writeManifest(root, { lodash: '^4.0.0' });
    const d = detectStacks(root);
    expect(d.size).toBe(0);
  });
});
