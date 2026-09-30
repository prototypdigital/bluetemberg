import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync, shouldExitWithFailure } from '../src/sync/index.js';
import { extractImports } from '../src/sync/claude-agents-md.js';
import type { BlueprintConfig, Platform } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function config(platforms: Platform[]): BlueprintConfig {
  return { platforms, source: 'llm', targets: {} };
}

const agentsMdWarnings = (warnings: string[]): string[] => warnings.filter((w) => w.includes('@AGENTS.md'));

describe('extractImports', () => {
  it('finds imports at line start and after whitespace', () => {
    expect(extractImports('@AGENTS.md\n\nSee @docs/a.md and @b.md')).toEqual([
      'AGENTS.md',
      'docs/a.md',
      'b.md',
    ]);
  });

  it('ignores email-like tokens, code spans, and fenced blocks', () => {
    const md = 'mail me@example.com\n`@AGENTS.md`\n\n```\n@AGENTS.md\n```\n';
    expect(extractImports(md)).toEqual([]);
  });

  it('unescapes backslash-escaped spaces', () => {
    expect(extractImports('@Design\\ Docs/api.md')).toEqual(['Design Docs/api.md']);
  });
});

describe('CLAUDE.md -> AGENTS.md import diagnostic', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function warningsFor(platforms: Platform[] = ['claude'], checkMode = false): Promise<string[]> {
    const results = await sync(root, { config: config(platforms), silent: true, checkMode });
    return agentsMdWarnings(results.warnings);
  }

  it('stays quiet for the scaffolded CLAUDE.md', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n\n## Claude-Specific\n');
    expect(await warningsFor()).toEqual([]);
  });

  it('stays quiet when there is no CLAUDE.md (Claude Code reads AGENTS.md natively)', async () => {
    expect(await warningsFor()).toEqual([]);
  });

  it('warns when CLAUDE.md lacks the import, without failing sync --check', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# Hand-written\n\nSee AGENTS.md for more.\n');
    const results = await sync(root, { config: config(['claude']), silent: true, checkMode: true });

    const warnings = agentsMdWarnings(results.warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CLAUDE.md exists');
    expect(shouldExitWithFailure(results, true)).toBe(false);
  });

  it('warns when only a CLAUDE.local.md shadows AGENTS.md', async () => {
    writeFileSync(join(root, 'CLAUDE.local.md'), 'my sandbox url\n');
    expect(await warningsFor()).toEqual([expect.stringContaining('CLAUDE.local.md exists')]);
  });

  it('accepts a transitive import', async () => {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'shared.md'), '@../AGENTS.md\n');
    writeFileSync(join(root, 'CLAUDE.md'), '@docs/shared.md\n');
    expect(await warningsFor()).toEqual([]);
  });

  it('treats an @token that points at a directory as prose, not a crash', async () => {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'CLAUDE.md'), 'see @docs for details\n');
    expect(await warningsFor()).toEqual([expect.stringContaining('CLAUDE.md exists')]);
  });

  it('resolves .claude/CLAUDE.md imports relative to that file', async () => {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), '@../AGENTS.md\n');
    expect(await warningsFor()).toEqual([]);
  });

  it('accepts a CLAUDE.md symlinked to AGENTS.md', async () => {
    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
    expect(await warningsFor()).toEqual([]);
  });

  it('ignores an import that only appears inside a code span', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), 'Use `@AGENTS.md` to import.\n');
    expect(await warningsFor()).toHaveLength(1);
  });

  it('does not run when claude is not a selected platform', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# No import\n');
    expect(await warningsFor(['cursor', 'codex'])).toEqual([]);
  });
});
