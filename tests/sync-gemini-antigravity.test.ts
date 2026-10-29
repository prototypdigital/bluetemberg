import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import { withGeneratedBanner } from '../src/sync/banner.js';
import type { BlueprintConfig } from '../src/types.js';

const RULES_BEGIN = '<!-- BEGIN BLUETEMBERG MANAGED RULES -->';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readJson(root: string, relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8')) as Record<string, unknown>;
}

const SCOPED_RULE = '---\ndescription: Styles\nscope: "src/**/*.css"\n---\n\n# CSS rule\n';

describe('gemini (Gemini CLI Enterprise)', () => {
  let root: string;
  const config: BlueprintConfig = { platforms: ['gemini'], source: 'llm' };

  beforeEach(() => {
    root = createTmpDir();
    write(root, 'AGENTS.md', '# Project\n');
    write(root, 'llm/rules/css.md', SCOPED_RULE);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('points Gemini at AGENTS.md, keeps GEMINI.md loadable, and writes no copy or context dir', async () => {
    const results = await sync(root, { config, silent: true });

    expect(results.errors).toEqual([]);
    expect(readJson(root, '.gemini/settings.json')).toEqual({
      context: { fileName: ['AGENTS.md', 'GEMINI.md'] },
    });
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(root, '.gemini', 'context'))).toBe(false);
  });

  it('folds rules into the AGENTS.md managed block, since Gemini has no per-path rules', async () => {
    await sync(root, { config, silent: true });

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(RULES_BEGIN);
    expect(agents).toContain('_Applies to: `src/**/*.css`_');
    expect(agents).toContain('# CSS rule');
  });

  it('merges into existing settings, touching only context.fileName', async () => {
    write(
      root,
      '.gemini/settings.json',
      JSON.stringify({ theme: 'Dracula', context: { fileName: 'CONTEXT.md', includeDirectories: ['docs'] } }),
    );

    await sync(root, { config, silent: true });

    expect(readJson(root, '.gemini/settings.json')).toEqual({
      theme: 'Dracula',
      context: { fileName: ['CONTEXT.md', 'AGENTS.md'], includeDirectories: ['docs'] },
    });
  });

  it('leaves a settings file that already lists AGENTS.md byte for byte', async () => {
    const handFormatted = '{ "context": { "fileName": ["GEMINI.md", "AGENTS.md"] }, "theme": "x" }\n';
    write(root, '.gemini/settings.json', handFormatted);

    await sync(root, { config, silent: true });

    expect(readFileSync(join(root, '.gemini', 'settings.json'), 'utf8')).toBe(handFormatted);
  });

  it('records an error and never overwrites a settings file it cannot parse', async () => {
    write(root, '.gemini/settings.json', '{ // comment\n "theme": "x" }');

    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.startsWith('.gemini/settings.json:'))).toBe(true);
    expect(readFileSync(join(root, '.gemini', 'settings.json'), 'utf8')).toBe(
      '{ // comment\n "theme": "x" }',
    );
  });

  it('re-syncs idempotently and passes sync --check', async () => {
    await sync(root, { config, silent: true });
    const settings = readFileSync(join(root, '.gemini', 'settings.json'), 'utf8');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');

    const again = await sync(root, { config, silent: true });
    const check = await sync(root, { config, silent: true, check: true });

    expect(again.errors).toEqual([]);
    expect(readFileSync(join(root, '.gemini', 'settings.json'), 'utf8')).toBe(settings);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(agents);
    expect(check.outOfSync).toBe(0);
  });

  describe('outputs of the old integration', () => {
    const legacyConfig: BlueprintConfig = {
      platforms: ['gemini'],
      source: 'llm',
      // What `init` scaffolded before: a rules target Gemini CLI never read.
      targets: { rules: { gemini: { dir: '.gemini/context', ext: '.md' } } },
    };

    beforeEach(() => {
      write(root, 'GEMINI.md', withGeneratedBanner('# Project\n', 'AGENTS.md'));
      write(root, '.gemini/context/css.md', withGeneratedBanner(SCOPED_RULE, 'rules/css.md'));
      write(root, '.gemini/context/notes.md', '# Hand-written\n');
    });

    it('ignores the legacy rules target with a warning', async () => {
      const results = await sync(root, { config: legacyConfig, silent: true });

      expect(
        results.warnings.some((w) => w.includes('targets.rules.gemini (.gemini/context) is ignored')),
      ).toBe(true);
    });

    it('reports the bannered GEMINI.md and context files as stale under --check', async () => {
      await sync(root, { config: legacyConfig, silent: true });

      const check = await sync(root, { config: legacyConfig, silent: true, check: true });

      expect(check.stale).toBe(2);
    });

    it('--prune removes the bannered outputs and keeps hand-written files', async () => {
      await sync(root, { config: legacyConfig, silent: true, prune: true });

      expect(existsSync(join(root, 'GEMINI.md'))).toBe(false);
      expect(existsSync(join(root, '.gemini', 'context', 'css.md'))).toBe(false);
      expect(readFileSync(join(root, '.gemini', 'context', 'notes.md'), 'utf8')).toBe('# Hand-written\n');
      expect(existsSync(join(root, '.gemini', 'settings.json'))).toBe(true);
    });

    it('keeps a hand-written GEMINI.md', async () => {
      write(root, 'GEMINI.md', '# Mine\n');

      await sync(root, { config: legacyConfig, silent: true, prune: true });

      expect(readFileSync(join(root, 'GEMINI.md'), 'utf8')).toBe('# Mine\n');
    });
  });
});

describe('antigravity (Antigravity CLI)', () => {
  let root: string;
  const config: BlueprintConfig = { platforms: ['antigravity'], source: 'llm' };

  beforeEach(() => {
    root = createTmpDir();
    write(root, 'AGENTS.md', '# Project\n');
    write(root, 'llm/rules/css.md', SCOPED_RULE);
    write(root, 'llm/rules/style.md', '---\ndescription: Style\nscope: "**"\n---\n\n# Style\n');
    write(root, 'llm/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Deploys\n---\n\nDeploy.\n');
    write(
      root,
      'llm/mcp.json',
      JSON.stringify({
        servers: ['interactive', { id: 'remote', type: 'http', url: 'https://example.com/mcp' }],
      }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes scoped rules to .agents/rules with trigger frontmatter, and leaves AGENTS.md alone', async () => {
    const results = await sync(root, { config, silent: true });

    expect(results.errors).toEqual([]);
    const css = readFileSync(join(root, '.agents', 'rules', 'css.md'), 'utf8');
    expect(css).toContain('trigger: glob');
    expect(css).toContain('globs: src/**/*.css');
    expect(readFileSync(join(root, '.agents', 'rules', 'style.md'), 'utf8')).toContain('trigger: always_on');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('# Project\n');
  });

  it('writes skills to .agents/skills', async () => {
    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.agents', 'skills', 'deploy', 'SKILL.md'))).toBe(true);
  });

  it('writes MCP servers in the Antigravity shape (command/args, serverUrl)', async () => {
    await sync(root, { config, silent: true });

    const servers = readJson(root, '.agents/mcp_config.json').mcpServers as Record<
      string,
      Record<string, unknown>
    >;
    expect(servers.interactive.command).toBe('npx');
    expect(servers.interactive).not.toHaveProperty('type');
    expect(servers.remote).toEqual({ serverUrl: 'https://example.com/mcp' });
  });

  it('merges with user-authored MCP entries and other keys', async () => {
    write(
      root,
      '.agents/mcp_config.json',
      JSON.stringify({
        mcpServers: { mine: { command: 'my-server' }, remote: { serverUrl: 'https://old.example.com' } },
        extra: true,
      }),
    );

    await sync(root, { config, silent: true });

    const merged = readJson(root, '.agents/mcp_config.json');
    const servers = merged.mcpServers as Record<string, unknown>;
    expect(merged.extra).toBe(true);
    expect(servers.mine).toEqual({ command: 'my-server' });
    expect(servers.remote).toEqual({ serverUrl: 'https://example.com/mcp' });
  });

  it('records an error and never overwrites an MCP config it cannot parse', async () => {
    write(root, '.agents/mcp_config.json', 'not json');

    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.startsWith('.agents/mcp_config.json:'))).toBe(true);
    expect(readFileSync(join(root, '.agents', 'mcp_config.json'), 'utf8')).toBe('not json');
  });

  it('re-syncs idempotently and passes sync --check', async () => {
    await sync(root, { config, silent: true });
    const mcp = readFileSync(join(root, '.agents', 'mcp_config.json'), 'utf8');

    await sync(root, { config, silent: true });
    const check = await sync(root, { config, silent: true, check: true });

    expect(readFileSync(join(root, '.agents', 'mcp_config.json'), 'utf8')).toBe(mcp);
    expect(check.outOfSync).toBe(0);
  });

  describe('alongside codex (shared .agents/skills)', () => {
    const both: BlueprintConfig = { platforms: ['codex', 'antigravity'], source: 'llm' };

    it('writes the shared skills dir once', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await sync(root, { config: both });
        const lines = log.mock.calls.map((call) => String(call[0]));
        expect(lines.filter((line) => line.includes('-> .agents/skills/'))).toHaveLength(1);
      } finally {
        log.mockRestore();
      }
    });

    it('prunes a removed shared skill without failing', async () => {
      await sync(root, { config: both, silent: true });
      rmSync(join(root, 'llm', 'skills', 'deploy'), { recursive: true, force: true });

      const pruned = await sync(root, { config: both, silent: true, prune: true });

      expect(pruned.errors).toEqual([]);
      expect(existsSync(join(root, '.agents', 'skills', 'deploy'))).toBe(false);
    });

    it('passes sync --check after a sync', async () => {
      await sync(root, { config: both, silent: true });

      const check = await sync(root, { config: both, silent: true, check: true });

      expect(check.outOfSync).toBe(0);
    });
  });
});
