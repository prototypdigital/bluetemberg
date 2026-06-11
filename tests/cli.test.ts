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

  it('exits 1 in check mode when files are out of sync', () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'test.md'),
      '---\ndescription: Test\nscope: "**"\n---\n\n# Test\n',
    );

    const r = runCli(['sync', '--check', '--silent', root], root);
    expect(r.status).toBe(1);
  });

  it('exits 1 via the --dry-run alias when files are out of sync', () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'test.md'),
      '---\ndescription: Test\nscope: "**"\n---\n\n# Test\n',
    );

    const r = runCli(['sync', '--dry-run', '--silent', root], root);
    expect(r.status).toBe(1);
  });

  it('exits 0 in check mode when files are already in sync', () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'test.md'),
      '---\ndescription: Test\nscope: "**"\n---\n\n# Test\n',
    );

    runCli(['sync', '--silent', root], root);
    const r = runCli(['sync', '--check', '--silent', root], root);
    expect(r.status).toBe(0);
  });

  it('exits 1 when config file contains invalid JSON', () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), '{ invalid }');

    const r = runCli(['sync', '--silent', root], root);
    expect(r.status).toBe(1);
  });

  it('exits 1 when config has unknown platform', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['vscode'], source: 'llm', targets: {} }),
    );

    const r = runCli(['sync', '--silent', root], root);
    expect(r.status).toBe(1);
  });
});

cliSuite('cli flags', () => {
  it('--help exits 0 and prints usage', () => {
    const r = runCli(['--help'], process.cwd());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bluetemberg');
    expect(r.stdout).toContain('sync');
  });

  it('--version exits 0 and prints a version string', () => {
    const r = runCli(['--version'], process.cwd());
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('unknown command exits non-zero', () => {
    const r = runCli(['notacommand'], process.cwd());
    expect(r.status).not.toBe(0);
  });

  it('--help --json exits 0 and prints machine-readable catalog', () => {
    const r = runCli(['--help', '--json'], repoRoot);
    expect(r.status).toBe(0);
    expect(r.stderr ?? '').toBe('');
    const parsed = JSON.parse(r.stdout.trim()) as {
      teamProfiles?: unknown;
      ruleCollections?: unknown;
      cliVersion?: string;
    };
    expect(Array.isArray(parsed.teamProfiles)).toBe(true);
    expect(Array.isArray(parsed.ruleCollections)).toBe(true);
    expect(parsed.cliVersion ?? '').toMatch(/\d+\.\d+\.\d+/);
  });
});

cliSuite('cli init headless', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('--non-interactive scaffolds without prompts', () => {
    const r = runCli(
      ['init', '--non-interactive', '--profile', 'devops', '--omit-mcp', '--platforms', 'claude', root],
      root,
    );
    expect(r.status).toBe(0);
    expect(existsSync(join(root, 'bluetemberg.config.json'))).toBe(true);
    expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(true);
  });

  it('rejects --config when the path is missing', () => {
    const missing = join(root, 'no-init-config-here.json');
    const r = runCli(['init', '--config', missing, root], root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Error: Init config not found:/);
    expect(r.stderr ?? '').not.toMatch(/readFileUtf8|readFileSync/);
  });

  it('accepts --silent only with `--non-interactive` or `--config`', () => {
    const r = runCli(['init', '--silent', root], root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/`--silent` requires `--non-interactive`/);
  });

  it('--non-interactive --silent exits 0 with minimal output', () => {
    const r = runCli(['init', '--non-interactive', '--silent', '--platforms', 'claude', root], root);
    expect(r.status).toBe(0);
    expect((r.stdout ?? '').trim()).toBe('');
    expect((r.stderr ?? '').trim()).toBe('');
    expect(existsSync(join(root, 'bluetemberg.config.json'))).toBe(true);
  });

  it('rejects --config combined with profile overrides', () => {
    const cfgPath = join(root, 'init.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        teamProfile: 'fullstack',
        projectName: 'p',
        projectDescription: '',
        packageManager: 'pnpm',
        platforms: ['claude'],
        ruleSource: 'collections',
        rules: [],
        ruleCollections: [],
        includeAgents: false,
        agents: [],
        includeSkills: false,
        skills: [],
        includeMcp: false,
        mcpServers: [],
      }),
    );

    const r = runCli(['init', '--config', cfgPath, '--profile', 'devops', root], root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Cannot combine/);
  });
});
