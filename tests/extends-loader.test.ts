import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveExtendedSourceDirs, mergeSourceFiles, mergeSourceDirs } from '../src/sync/extends-loader.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-extends-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function hasSkillMd(dirPath: string): boolean {
  return existsSync(join(dirPath, 'SKILL.md'));
}

describe('resolveExtendedSourceDirs', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when extends is undefined', () => {
    expect(resolveExtendedSourceDirs(undefined, root)).toEqual([]);
  });

  it('returns empty array when extends is empty array', () => {
    expect(resolveExtendedSourceDirs([], root)).toEqual([]);
  });

  it('resolves relative path that has a llm/ subdirectory', () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm'), { recursive: true });

    const pkg = join(root, 'packages', 'frontend');
    mkdirSync(pkg, { recursive: true });

    const result = resolveExtendedSourceDirs(['../../shared'], pkg);
    expect(result).toEqual([join(shared, 'llm')]);
  });

  it('falls back to the path itself when no llm/ subdirectory exists', () => {
    const shared = join(root, 'shared-rules');
    mkdirSync(shared, { recursive: true });

    const result = resolveExtendedSourceDirs([shared], root);
    expect(result).toEqual([shared]);
  });

  it('accepts a plain string (not array)', () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm'), { recursive: true });

    const pkg = join(root, 'pkg');
    mkdirSync(pkg, { recursive: true });

    const result = resolveExtendedSourceDirs('../shared', pkg);
    expect(result).toEqual([join(shared, 'llm')]);
  });

  it('skips entries whose path does not exist', () => {
    const result = resolveExtendedSourceDirs(['./nonexistent'], root);
    expect(result).toEqual([]);
  });

  it('resolves npm package from node_modules with llm/ dir', () => {
    const pkgLlm = join(root, 'node_modules', '@company', 'ai-rules', 'llm');
    mkdirSync(pkgLlm, { recursive: true });

    const result = resolveExtendedSourceDirs(['@company/ai-rules'], root);
    expect(result).toEqual([pkgLlm]);
  });

  it('resolves npm package from node_modules without llm/ dir', () => {
    const pkgBase = join(root, 'node_modules', 'my-rules');
    mkdirSync(pkgBase, { recursive: true });

    const result = resolveExtendedSourceDirs(['my-rules'], root);
    expect(result).toEqual([pkgBase]);
  });

  it('skips npm packages not found in node_modules', () => {
    const result = resolveExtendedSourceDirs(['nonexistent-package'], root);
    expect(result).toEqual([]);
  });

  it('resolves multiple entries, skipping missing ones', () => {
    const shared1 = join(root, 'shared1');
    mkdirSync(join(shared1, 'llm'), { recursive: true });

    const result = resolveExtendedSourceDirs(['./shared1', './missing'], root);
    expect(result).toEqual([join(shared1, 'llm')]);
  });
});

describe('mergeSourceFiles', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty map when subdir does not exist', () => {
    const result = mergeSourceFiles([root], 'rules', (f) => f.endsWith('.md'));
    expect(result.size).toBe(0);
  });

  it('collects files from a single dir', () => {
    const rulesDir = join(root, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'a.md'), '# A');

    const result = mergeSourceFiles([root], 'rules', (f) => f.endsWith('.md'));
    expect(result.size).toBe(1);
    expect(result.get('a.md')).toBe(rulesDir);
  });

  it('local dir (index 0) wins over extended dir (index 1) for the same filename', () => {
    const local = join(root, 'local');
    const extended = join(root, 'extended');
    mkdirSync(join(local, 'rules'), { recursive: true });
    mkdirSync(join(extended, 'rules'), { recursive: true });
    writeFileSync(join(local, 'rules', 'shared.md'), '# local version');
    writeFileSync(join(extended, 'rules', 'shared.md'), '# extended version');

    const result = mergeSourceFiles([local, extended], 'rules', (f) => f.endsWith('.md'));
    expect(result.get('shared.md')).toBe(join(local, 'rules'));
  });

  it('extended files not overridden by local are included', () => {
    const local = join(root, 'local');
    const extended = join(root, 'extended');
    mkdirSync(join(local, 'rules'), { recursive: true });
    mkdirSync(join(extended, 'rules'), { recursive: true });
    writeFileSync(join(local, 'rules', 'local-only.md'), '# local');
    writeFileSync(join(extended, 'rules', 'extended-only.md'), '# extended');

    const result = mergeSourceFiles([local, extended], 'rules', (f) => f.endsWith('.md'));
    expect(result.size).toBe(2);
    expect(result.get('local-only.md')).toBe(join(local, 'rules'));
    expect(result.get('extended-only.md')).toBe(join(extended, 'rules'));
  });

  it('applies the filter to exclude unwanted files', () => {
    const rulesDir = join(root, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'a.md'), '# A');
    writeFileSync(join(rulesDir, 'README.md'), '# readme');

    const result = mergeSourceFiles([root], 'rules', (f) => f.endsWith('.md') && f !== 'README.md');
    expect(result.size).toBe(1);
    expect(result.has('a.md')).toBe(true);
    expect(result.has('README.md')).toBe(false);
  });
});

describe('mergeSourceDirs', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty map when subdir does not exist', () => {
    const result = mergeSourceDirs([root], 'skills', hasSkillMd);
    expect(result.size).toBe(0);
  });

  it('excludes dirs that fail the hasIndex check', () => {
    const skillsDir = join(root, 'skills');
    mkdirSync(join(skillsDir, 'no-index'), { recursive: true });

    const result = mergeSourceDirs([root], 'skills', hasSkillMd);
    expect(result.size).toBe(0);
  });

  it('collects dirs that pass the hasIndex check', () => {
    const skillsDir = join(root, 'skills');
    mkdirSync(join(skillsDir, 'my-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'my-skill', 'SKILL.md'), '# skill');

    const result = mergeSourceDirs([root], 'skills', hasSkillMd);
    expect(result.size).toBe(1);
    expect(result.get('my-skill')).toBe(skillsDir);
  });

  it('local dir (index 0) wins for the same skill name', () => {
    const local = join(root, 'local');
    const extended = join(root, 'extended');
    mkdirSync(join(local, 'skills', 'shared-skill'), { recursive: true });
    writeFileSync(join(local, 'skills', 'shared-skill', 'SKILL.md'), '# local');
    mkdirSync(join(extended, 'skills', 'shared-skill'), { recursive: true });
    writeFileSync(join(extended, 'skills', 'shared-skill', 'SKILL.md'), '# extended');

    const result = mergeSourceDirs([local, extended], 'skills', hasSkillMd);
    expect(result.get('shared-skill')).toBe(join(local, 'skills'));
  });

  it('extended skills not overridden by local are included', () => {
    const local = join(root, 'local');
    const extended = join(root, 'extended');
    mkdirSync(join(local, 'skills', 'local-skill'), { recursive: true });
    writeFileSync(join(local, 'skills', 'local-skill', 'SKILL.md'), '# local');
    mkdirSync(join(extended, 'skills', 'extended-skill'), { recursive: true });
    writeFileSync(join(extended, 'skills', 'extended-skill', 'SKILL.md'), '# extended');

    const result = mergeSourceDirs([local, extended], 'skills', hasSkillMd);
    expect(result.size).toBe(2);
    expect(result.get('local-skill')).toBe(join(local, 'skills'));
    expect(result.get('extended-skill')).toBe(join(extended, 'skills'));
  });
});
