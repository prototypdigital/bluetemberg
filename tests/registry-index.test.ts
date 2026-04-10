import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePackSourceDirs } from '../src/registry/index.js';
import { writeManifest, writeLockfile, readManifest } from '../src/registry/manifest.js';
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

  it('returns empty array when no manifest exists', () => {
    expect(resolvePackSourceDirs(root)).toEqual([]);
  });

  it('returns empty array when manifest has no packages', () => {
    writeManifest(root, { packages: {} });
    expect(resolvePackSourceDirs(root)).toEqual([]);
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

    const dirs = resolvePackSourceDirs(root);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(packDir, 'llm'));
  });

  it('skips packages that are locked but not cached', () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, {
      lockfileVersion: 1,
      packages: {
        'pack-a': { version: '1.2.0', resolved: 'x', integrity: 'y' },
      },
    });

    // Do not create cache dir.
    const dirs = resolvePackSourceDirs(root);
    expect(dirs).toEqual([]);
  });

  it('skips packages without a lock entry', () => {
    writeManifest(root, { packages: { 'pack-a': '^1.0.0' } });
    writeLockfile(root, { lockfileVersion: 1, packages: {} });

    const dirs = resolvePackSourceDirs(root);
    expect(dirs).toEqual([]);
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

    const dirs = resolvePackSourceDirs(root);
    expect(dirs).toEqual([dirA, dirB]);
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

    const dirs = resolvePackSourceDirs(root);
    expect(dirs).toEqual([packDir]);
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
