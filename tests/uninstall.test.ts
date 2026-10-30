import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from '../src/sync/index.js';
import { uninstall } from '../src/uninstall/index.js';

const GUARDRAIL = `---
description: Branch names
trigger: EnterWorktree
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'Use type/description.'
---

# Branch names
`;

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function json(root: string, rel: string): Record<string, unknown> {
  return JSON.parse(read(root, rel)) as Record<string, unknown>;
}

/** A synced project with every kind of output uninstall has to reason about, plus files a person wrote. */
async function syncedProject(root: string): Promise<void> {
  write(
    root,
    'bluetemberg.config.json',
    JSON.stringify({
      platforms: ['cursor', 'claude', 'copilot', 'gemini', 'codex', 'claude-marketplace'],
      source: 'llm',
      marketplace: { remote: 'acme/mkt', plugins: [{ name: 'core', displayName: 'Core' }] },
    }),
  );
  write(root, 'llm/rules/r.md', '---\ndescription: d\nscope: "**"\n---\n# R\nbody\n');
  write(root, 'llm/guardrails/branch.md', GUARDRAIL);
  write(root, 'llm/mcp.json', JSON.stringify({ servers: ['context7'] }));
  write(
    root,
    'llm/hooks.claude.json',
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
  );
  write(root, 'llm/packages.json', JSON.stringify({ packages: {} }));
  write(root, 'AGENTS.md', '# Project\n\nWritten by a person.\n');
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { mine: { command: 'my-server' } } }));
  write(root, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  write(
    root,
    '.gitignore',
    'dist/\n\n# Bluetemberg cache\n.bluetemberg/\n\n# Registry credentials\n.npmrc\n',
  );
  write(root, '.bluetemberg/catalog.json', '{}');
  const results = await sync(root, { silent: true, recursive: false });
  expect(results.errors).toEqual([]);
}

describe('uninstall', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-uninstall-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('refuses a directory without bluetemberg.config.json', async () => {
    await expect(uninstall(root)).rejects.toThrow('nothing to uninstall');
  });

  it('dry run reports the plan and changes nothing', async () => {
    await syncedProject(root);
    const generatedRule = read(root, '.claude/rules/r.md');

    const plan = await uninstall(root, { dryRun: true });

    expect(plan.removed).toEqual(expect.arrayContaining(['bluetemberg.config.json', '.claude/rules/r.md']));
    expect(plan.edited).toEqual(expect.arrayContaining(['.claude/settings.json', '.mcp.json']));
    expect(read(root, '.claude/rules/r.md')).toBe(generatedRule);
    expect(existsSync(join(root, 'bluetemberg.config.json'))).toBe(true);
  });

  it('removes generated output and state, keeps what a person wrote', async () => {
    await syncedProject(root);

    const result = await uninstall(root);

    for (const gone of [
      'bluetemberg.config.json',
      '.bluetemberg',
      '.claude/rules/r.md',
      '.cursor/rules/r.mdc',
      '.cursor/mcp.json',
      '.github/copilot-instructions.md',
      '.gemini/settings.json',
      '.codex/config.toml',
      '.claude-plugin/marketplace.json',
      'plugins',
      'llm/mcp.json',
      'llm/packages.json',
    ]) {
      expect(existsSync(join(root, gone)), gone).toBe(false);
    }
    expect(result.removed).toContain('.claude/rules/r.md');
    expect(read(root, 'llm/rules/r.md')).toContain('# R');
    expect(read(root, 'AGENTS.md')).toBe('# Project\n\nWritten by a person.\n');
  });

  it('takes only bluetemberg-owned keys out of shared JSON files', async () => {
    await syncedProject(root);

    await uninstall(root);

    expect(json(root, '.claude/settings.json')).toEqual({ permissions: { allow: ['Bash(ls)'] } });
    expect(json(root, '.mcp.json')).toEqual({ mcpServers: { mine: { command: 'my-server' } } });
  });

  it('drops the cache ignore entry but keeps the .npmrc guard', async () => {
    await syncedProject(root);

    await uninstall(root);

    const gitignore = read(root, '.gitignore');
    expect(gitignore).not.toContain('.bluetemberg/');
    expect(gitignore).toContain('.npmrc');
    expect(gitignore).toContain('dist/');
  });
});
