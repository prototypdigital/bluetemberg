import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

const SYNC_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sync');

/** Every platform, so each built-in adapter runs. */
const ALL_PLATFORMS_CONFIG: BlueprintConfig = {
  platforms: ['cursor', 'claude', 'copilot', 'gemini', 'windsurf', 'codex', 'claude-marketplace'],
  source: 'llm',
  marketplace: { remote: 'acme/ai-marketplace' },
};

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSource(root: string, relPath: string, content: string): void {
  const abs = join(root, 'llm', relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** One source for every built-in sync stage: rules, agents, skills, commands, prompts, MCP, hooks. */
function writeAllSources(root: string): void {
  writeSource(root, 'rules/style.md', '---\ndescription: Style\nscope: "**"\n---\n\n# Style\n');
  writeSource(root, 'agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews\n---\n\nReview.\n');
  writeSource(root, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Deploys\n---\n\nDeploy.\n');
  writeSource(root, 'commands/ship.md', '# Ship\n');
  writeSource(root, 'prompts/explain.md', '# Explain\n');
  writeSource(root, 'mcp.json', JSON.stringify({ servers: ['interactive'] }));
  writeSource(
    root,
    'hooks.json',
    JSON.stringify({ hooks: { beforeSubmitPrompt: [{ command: 'npm run lint' }] } }),
  );
  writeSource(
    root,
    'hooks.claude.json',
    JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: './retro.sh' }] }] } }),
  );
  writeFileSync(join(root, 'AGENTS.md'), '# Project\n');
}

/** Every path under `root` (dirs marked with a trailing `/`) mapped to its content and mtime. */
function snapshotTree(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (entry.isDirectory()) {
        snapshot.set(`${rel}/`, String(statSync(abs).mtimeMs));
        walk(abs);
        continue;
      }
      snapshot.set(rel, `${statSync(abs).mtimeMs}:${readFileSync(abs, 'utf8')}`);
    }
  };
  walk(root);
  return snapshot;
}

describe('sync --check is read-only', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    writeAllSources(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves the tree untouched on a project with no generated output', async () => {
    const before = snapshotTree(root);

    const results = await sync(root, { config: ALL_PLATFORMS_CONFIG, check: true, silent: true });

    // Drift was found everywhere, so every adapter planned writes — and none reached disk.
    expect(results.errors).toEqual([]);
    expect(results.outOfSync).toBeGreaterThan(0);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('leaves the tree untouched when generated output has drifted', async () => {
    await sync(root, { config: ALL_PLATFORMS_CONFIG, silent: true });
    writeSource(root, 'rules/style.md', '---\ndescription: Style\nscope: "**"\n---\n\n# Changed\n');
    rmSync(join(root, '.claude'), { recursive: true, force: true });
    const before = snapshotTree(root);

    const results = await sync(root, { config: ALL_PLATFORMS_CONFIG, check: true, silent: true });

    expect(results.outOfSync).toBeGreaterThan(0);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('keeps directory creation inside commitPlannedWrite (no direct mkdir in sync stages)', () => {
    // A direct mkdir bypasses the check-mode funnel and regresses #242 in code paths the fixture
    // above may not reach. Write-mode parent dirs are created by `writeOrCheck`.
    const offenders = readdirSync(SYNC_SRC_DIR)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\b(ensureDir|mkdirSync)\s*\(/.test(readFileSync(join(SYNC_SRC_DIR, f), 'utf8')));

    expect(offenders).toEqual([]);
  });
});
