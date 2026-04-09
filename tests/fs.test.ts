import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeOrCheck } from '../src/utils/fs.js';

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
});
