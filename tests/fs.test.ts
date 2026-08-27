import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeOrCheck,
  computeCheck,
  ensureDir,
  readIfExists,
  listFiles,
  listDirs,
  ensureGitignore,
} from '../src/utils/fs.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('writeOrCheck', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats CRLF and LF as equal in check mode', () => {
    const filePath = join(dir, 'x.txt');
    writeFileSync(filePath, 'line1\r\nline2', 'utf8');
    expect(writeOrCheck(filePath, 'line1\nline2', true)).toBe(false);
  });

  it('reports diff when content differs after newline normalization', () => {
    const filePath = join(dir, 'y.txt');
    writeFileSync(filePath, 'a\r\nb', 'utf8');
    expect(writeOrCheck(filePath, 'a\nc', true)).toBe(true);
  });

  it('reports out-of-sync when file does not exist in check mode', () => {
    const filePath = join(dir, 'nonexistent.txt');
    expect(writeOrCheck(filePath, 'content', true)).toBe(true);
  });

  it('writes file and returns false in write mode', () => {
    const filePath = join(dir, 'new.txt');
    const result = writeOrCheck(filePath, 'hello', false);
    expect(result).toBe(false);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('computeCheck', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns in-sync with both normalized sides when content matches', () => {
    const filePath = join(dir, 'x.txt');
    writeFileSync(filePath, 'a\r\nb', 'utf8');
    const result = computeCheck(filePath, 'a\nb');
    expect(result.outOfSync).toBe(false);
    expect(result.existing).toBe('a\nb');
    expect(result.content).toBe('a\nb');
  });

  it('returns out-of-sync with both sides when content differs', () => {
    const filePath = join(dir, 'y.txt');
    writeFileSync(filePath, 'a\nb', 'utf8');
    const result = computeCheck(filePath, 'a\nc');
    expect(result.outOfSync).toBe(true);
    expect(result.existing).toBe('a\nb');
    expect(result.content).toBe('a\nc');
  });

  it('reports a missing file as out-of-sync with null existing', () => {
    const result = computeCheck(join(dir, 'nope.txt'), 'content');
    expect(result.outOfSync).toBe(true);
    expect(result.existing).toBeNull();
    expect(result.content).toBe('content');
  });
});

describe('ensureDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bluetemberg-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a directory recursively', () => {
    const target = join(dir, 'a', 'b', 'c');
    ensureDir(target);
    expect(existsSync(target)).toBe(true);
  });

  it('does not throw when directory already exists', () => {
    expect(() => ensureDir(dir)).not.toThrow();
  });
});

describe('readIfExists', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bluetemberg-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns file content when file exists', () => {
    const filePath = join(dir, 'file.txt');
    writeFileSync(filePath, 'hello world', 'utf8');
    expect(readIfExists(filePath)).toBe('hello world');
  });

  it('returns null when file does not exist', () => {
    expect(readIfExists(join(dir, 'missing.txt'))).toBeNull();
  });
});

describe('listFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bluetemberg-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns filtered files in a directory', () => {
    writeFileSync(join(dir, 'a.md'), '');
    writeFileSync(join(dir, 'b.md'), '');
    writeFileSync(join(dir, 'c.txt'), '');
    const result = listFiles(dir, (f) => f.endsWith('.md'));
    expect(result.sort()).toEqual(['a.md', 'b.md']);
  });

  it('returns empty array when directory does not exist', () => {
    expect(listFiles(join(dir, 'nonexistent'), () => true)).toEqual([]);
  });

  it('returns empty array when no files match filter', () => {
    writeFileSync(join(dir, 'a.txt'), '');
    expect(listFiles(dir, (f) => f.endsWith('.md'))).toEqual([]);
  });
});

describe('listDirs', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bluetemberg-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns subdirectory names', () => {
    mkdirSync(join(dir, 'sub-a'));
    mkdirSync(join(dir, 'sub-b'));
    writeFileSync(join(dir, 'file.txt'), '');
    const result = listDirs(dir);
    expect(result.sort()).toEqual(['sub-a', 'sub-b']);
  });

  it('returns empty array when directory does not exist', () => {
    expect(listDirs(join(dir, 'nonexistent'))).toEqual([]);
  });

  it('returns empty array when directory has no subdirectories', () => {
    writeFileSync(join(dir, 'file.txt'), '');
    expect(listDirs(dir)).toEqual([]);
  });
});

describe('ensureGitignore', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = () => readFileSync(join(dir, '.gitignore'), 'utf8');

  it('does not create a .gitignore for a non-git project', () => {
    ensureGitignore(dir);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('always ignores the cache', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    ensureGitignore(dir);

    const content = read();
    expect(content).toContain('node_modules/');
    expect(content).toContain('.bluetemberg/');
  });

  /**
   * `.npmrc` is where the docs tell users to put registry credentials, so once it holds
   * a credential key the project that manages their .gitignore has to ignore it — an
   * accidentally committed token is the most expensive mistake this tool can invite.
   * A `${VAR}` reference counts: that file is where a literal token would land later.
   */
  it('ignores .npmrc once it holds a credential key', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(dir, '.npmrc'), '//npm.acme.test/:_authToken=${NPM_TOKEN}\n');
    ensureGitignore(dir);

    const content = read();
    expect(content).toContain('.bluetemberg/');
    expect(content).toContain('.npmrc');
  });

  /**
   * A tokenless `.npmrc` (registry pointer, scope mappings, save-exact) is a file many
   * projects commit deliberately — blanket-ignoring it would silently hide a new one
   * and produce registry drift nobody traces back to this tool.
   */
  it('leaves a tokenless .npmrc committable', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(dir, '.npmrc'), 'registry=https://npm.acme.test\nsave-exact=true\n');
    ensureGitignore(dir);

    expect(read()).not.toContain('.npmrc');
  });

  it('does not ignore .npmrc when the project has none', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    ensureGitignore(dir);

    expect(read()).not.toContain('.npmrc');
  });

  it('adds only what is missing, leaving an existing entry alone', () => {
    writeFileSync(join(dir, '.gitignore'), '.bluetemberg/\n');
    writeFileSync(join(dir, '.npmrc'), '//npm.acme.test/:_authToken=${NPM_TOKEN}\n');
    ensureGitignore(dir);

    const content = read();
    expect(content.match(/^\.bluetemberg\/$/gm)).toHaveLength(1);
    expect(content).toContain('.npmrc');
  });

  it('treats a root-anchored /.npmrc line as already present', () => {
    writeFileSync(join(dir, '.gitignore'), '.bluetemberg/\n/.npmrc\n');
    writeFileSync(join(dir, '.npmrc'), '//npm.acme.test/:_authToken=${NPM_TOKEN}\n');
    ensureGitignore(dir);

    expect(read().match(/npmrc/g)).toHaveLength(1);
  });

  it('is not fooled by a line that merely contains the entry as a substring', () => {
    writeFileSync(join(dir, '.gitignore'), '*.npmrc.bak\n');
    writeFileSync(join(dir, '.npmrc'), '//npm.acme.test/:_authToken=${NPM_TOKEN}\n');
    ensureGitignore(dir);

    expect(read().match(/^\.npmrc$/gm)).toHaveLength(1);
  });

  it('is idempotent', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(dir, '.npmrc'), '//npm.acme.test/:_authToken=${NPM_TOKEN}\n');
    ensureGitignore(dir);
    const once = read();
    ensureGitignore(dir);

    expect(read()).toBe(once);
  });
});
