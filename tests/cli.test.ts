import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = join(repoRoot, 'bin', 'cli.js');
const distSync = join(repoRoot, 'dist', 'sync', 'index.js');

const runCli = (args: string[], cwd: string) =>
  spawnSync(process.execPath, [cliJs, ...args], {
    cwd,
    encoding: 'utf8',
  });

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const cliSuite = existsSync(distSync) ? describe : describe.skip;

cliSuite('cli sync exit code', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 when sync records errors', () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'hooks.json'), JSON.stringify({ hooks: { bad: 'not-array' } }));

    const r = runCli(['sync', '--silent', root], root);
    expect(r.status).toBe(1);
  });

  it('exits 0 when sync succeeds with no sources', () => {
    const r = runCli(['sync', '--silent', root], root);
    expect(r.status).toBe(0);
  });
});
