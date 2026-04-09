import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { sync, loadConfig, shouldExitWithFailure } from '../src/sync/index.js';
import { DEFAULT_TARGETS } from '../src/sync/transform.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('sync', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs rules to all platforms', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'test-rule.md'),
      '---\ndescription: A test rule\nscope: "**"\n---\n\n# Test Rule\n\nContent here.\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor', 'claude', 'copilot'],
      source: 'llm',
      targets: {
        rules: {
          cursor: { dir: '.cursor/rules', ext: '.mdc' },
          claude: { dir: '.claude/rules', ext: '.md' },
          copilot: { dir: '.github/instructions', ext: '.instructions.md' },
        },
      },
    };

    const results = await sync(root, { config, silent: true });

    expect(results.synced).toBe(3);
    expect(existsSync(join(root, '.cursor', 'rules', 'test-rule.mdc'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'rules', 'test-rule.md'))).toBe(true);
    expect(existsSync(join(root, '.github', 'instructions', 'test-rule.instructions.md'))).toBe(true);

    const cursorContent = readFileSync(join(root, '.cursor', 'rules', 'test-rule.mdc'), 'utf8');
    expect(cursorContent).toContain('alwaysApply: true');

    const claudeContent = readFileSync(join(root, '.claude', 'rules', 'test-rule.md'), 'utf8');
    expect(claudeContent).toContain("paths:\n  - '**'");

    const copilotContent = readFileSync(
      join(root, '.github', 'instructions', 'test-rule.instructions.md'),
      'utf8',
    );
    expect(copilotContent).toContain("applyTo: '**'");
  });

  it('syncs scoped rules correctly', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'scoped.md'),
      '---\ndescription: Scoped rule\nscope: "src/**"\n---\n\n# Scoped\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
      },
    };

    await sync(root, { config, silent: true });

    const content = readFileSync(join(root, '.cursor', 'rules', 'scoped.mdc'), 'utf8');
    expect(content).toContain('globs:');
    expect(content).toContain('src/**');
    expect(content).not.toContain('alwaysApply');
  });

  it('syncs agents verbatim', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    const agentContent = '---\nname: test-agent\ndescription: Test\n---\n\n# Test Agent\n';
    writeFileSync(join(root, 'llm', 'agents', 'test-agent.md'), agentContent);

    const config: BlueprintConfig = {
      platforms: ['claude', 'copilot'],
      source: 'llm',
      targets: {
        agents: {
          claude: { dir: '.claude/agents', ext: '.md' },
          copilot: { dir: '.github/agents', ext: '.agent.md' },
        },
      },
    };

    await sync(root, { config, silent: true });

    expect(readFileSync(join(root, '.claude', 'agents', 'test-agent.md'), 'utf8')).toBe(agentContent);
    expect(readFileSync(join(root, '.github', 'agents', 'test-agent.agent.md'), 'utf8')).toBe(agentContent);
  });

  it('syncs skills verbatim', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'test-skill'), { recursive: true });
    const skillContent = '---\nname: test-skill\n---\n\n# Test\n';
    writeFileSync(join(root, 'llm', 'skills', 'test-skill', 'SKILL.md'), skillContent);

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {
        skills: { claude: { dir: '.claude/skills' } },
      },
    };

    await sync(root, { config, silent: true });

    expect(readFileSync(join(root, '.claude', 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toBe(
      skillContent,
    );
  });

  it('syncs agents and skills to cursor with default-shaped targets', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    const agentContent = '---\nname: sub\ndescription: Subagent\n---\n\n# Body\n';
    writeFileSync(join(root, 'llm', 'agents', 'sub.md'), agentContent);

    mkdirSync(join(root, 'llm', 'skills', 'my-skill'), { recursive: true });
    const skillContent = '---\nname: my-skill\n---\n\n# Skill\n';
    writeFileSync(join(root, 'llm', 'skills', 'my-skill', 'SKILL.md'), skillContent);

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        agents: { cursor: { dir: '.cursor/agents', ext: '.md' } },
        skills: { cursor: { dir: '.cursor/skills' } },
      },
    };

    const results = await sync(root, { config, silent: true });
    expect(results.synced).toBe(2);
    expect(readFileSync(join(root, '.cursor', 'agents', 'sub.md'), 'utf8')).toBe(agentContent);
    expect(readFileSync(join(root, '.cursor', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(skillContent);
  });

  it('check mode reports out-of-sync files', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'check-test.md'),
      '---\ndescription: Check\nscope: "**"\n---\n\n# Check\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
      },
    };

    const results = await sync(root, { check: true, config, silent: true });
    expect(results.outOfSync).toBe(1);
  });

  it('check mode reports in-sync after full sync', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'synced.md'),
      '---\ndescription: Synced\nscope: "**"\n---\n\n# Synced\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
      },
    };

    await sync(root, { config, silent: true });
    const results = await sync(root, { check: true, config, silent: true });
    expect(results.outOfSync).toBe(0);
  });

  it('syncs AGENTS.md to copilot instructions', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My Project\n\nProject docs.\n');

    const config: BlueprintConfig = {
      platforms: ['copilot'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const copilotInstructions = readFileSync(join(root, '.github', 'copilot-instructions.md'), 'utf8');
    expect(copilotInstructions).toBe('# My Project\n\nProject docs.\n');
  });

  it('handles empty rules directory gracefully', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
      },
    };

    const results = await sync(root, { config, silent: true });
    expect(results.synced).toBe(0);
    expect(results.outOfSync).toBe(0);
    expect(results.errors).toEqual([]);
  });

  it('skips skill directories without SKILL.md', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'valid-skill'), { recursive: true });
    mkdirSync(join(root, 'llm', 'skills', 'empty-dir'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'skills', 'valid-skill', 'SKILL.md'),
      '---\nname: valid\n---\n\n# Valid\n',
    );

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {
        skills: { claude: { dir: '.claude/skills' } },
      },
    };

    const results = await sync(root, { config, silent: true });
    expect(results.synced).toBe(1);
    expect(existsSync(join(root, '.claude', 'skills', 'valid-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'empty-dir', 'SKILL.md'))).toBe(false);
  });

  it('syncs MCP from llm/mcp.json to Claude, Copilot, and Cursor shapes', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'mcp.json'),
      JSON.stringify({ servers: ['interactive'] }, null, 2) + '\n',
    );

    const config: BlueprintConfig = {
      platforms: ['claude', 'copilot', 'cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const claudeRaw = readFileSync(join(root, '.claude', 'mcp.json'), 'utf8');
    const claude = JSON.parse(claudeRaw) as { mcpServers: Record<string, { type: string }> };
    expect(claude.mcpServers.interactive?.type).toBe('stdio');

    const ghRaw = readFileSync(join(root, '.github', 'mcp.json'), 'utf8');
    const gh = JSON.parse(ghRaw) as { servers: Record<string, { type: string }> };
    expect(gh.servers.interactive?.type).toBe('stdio');

    const cursorRaw = readFileSync(join(root, '.cursor', 'mcp.json'), 'utf8');
    const cursor = JSON.parse(cursorRaw) as { mcpServers: Record<string, { type: string }> };
    expect(cursor.mcpServers.interactive?.type).toBe('stdio');
  });

  it('records error for unknown MCP server id in llm/mcp.json', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['not-a-real-server'] }));

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    const results = await sync(root, { config, silent: true });
    expect(results.errors.some((e) => e.includes('unknown server id'))).toBe(true);
  });

  it('syncs MCP manifest mixing preset ids and inline server objects', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'mcp.json'),
      JSON.stringify(
        {
          servers: [
            'interactive',
            {
              id: 'custom-tool',
              type: 'stdio',
              command: 'node',
              args: ['./mcp-server.mjs'],
            },
          ],
        },
        null,
        2,
      ) + '\n',
    );

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const claude = JSON.parse(readFileSync(join(root, '.claude', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { type: string; command?: string; args?: string[] }>;
    };
    expect(claude.mcpServers.interactive?.type).toBe('stdio');
    expect(claude.mcpServers['custom-tool']?.type).toBe('stdio');
    expect(claude.mcpServers['custom-tool']?.command).toBe('node');
    expect(claude.mcpServers['custom-tool']?.args).toEqual(['./mcp-server.mjs']);
  });

  it('syncs llm/hooks.json to .cursor/hooks.json when cursor is enabled', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    const hooksDoc = {
      version: 1,
      hooks: { beforeSubmitPrompt: [{ command: 'npm run lint' }] },
    };
    writeFileSync(join(root, 'llm', 'hooks.json'), JSON.stringify(hooksDoc, null, 2));

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const out = JSON.parse(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf8')) as typeof hooksDoc;
    expect(out.version).toBe(1);
    expect(out.hooks.beforeSubmitPrompt).toEqual([{ command: 'npm run lint' }]);
  });

  it('skips hooks sync when cursor is not enabled', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'hooks.json'), JSON.stringify({ version: 1, hooks: {} }));

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('records error for invalid llm/hooks.json', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'hooks.json'), JSON.stringify({ hooks: { bad: 'not-array' } }));

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
    };

    const results = await sync(root, { config, silent: true });
    expect(results.errors.some((e) => e.includes('hooks.json'))).toBe(true);
  });

  it('syncs llm/commands to .claude/commands verbatim', async () => {
    mkdirSync(join(root, 'llm', 'commands'), { recursive: true });
    const body = '---\ndescription: Test cmd\n---\n\nDo something with $ARGUMENTS\n';
    writeFileSync(join(root, 'llm', 'commands', 'my-cmd.md'), body);

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, '.claude', 'commands', 'my-cmd.md'), 'utf8')).toBe(body);
  });

  it('skips commands sync when claude is not enabled', async () => {
    mkdirSync(join(root, 'llm', 'commands'), { recursive: true });
    writeFileSync(join(root, 'llm', 'commands', 'x.md'), '# X\n');

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.claude', 'commands', 'x.md'))).toBe(false);
  });

  it('syncs llm/prompts to .github/prompts as .prompt.md when copilot is enabled', async () => {
    mkdirSync(join(root, 'llm', 'prompts'), { recursive: true });
    const body = '---\ndescription: Review PR\n---\n\n# Review\n';
    writeFileSync(join(root, 'llm', 'prompts', 'review.md'), body);

    const config: BlueprintConfig = {
      platforms: ['copilot'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, '.github', 'prompts', 'review.prompt.md'), 'utf8')).toBe(body);
  });

  it('passes through llm/prompts/*.prompt.md filenames to .github/prompts', async () => {
    mkdirSync(join(root, 'llm', 'prompts'), { recursive: true });
    writeFileSync(join(root, 'llm', 'prompts', 'fix.prompt.md'), '# Fix\n');

    const config: BlueprintConfig = {
      platforms: ['copilot'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, '.github', 'prompts', 'fix.prompt.md'), 'utf8')).toBe('# Fix\n');
  });

  it('skips prompts sync when copilot is not enabled', async () => {
    mkdirSync(join(root, 'llm', 'prompts'), { recursive: true });
    writeFileSync(join(root, 'llm', 'prompts', 'a.md'), '# A\n');

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.github', 'prompts', 'a.prompt.md'))).toBe(false);
  });

  it('loads and runs optional adapters from config', async () => {
    const adapterHref = pathToFileURL(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures/touch-adapter.mjs'),
    ).href;
    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
      adapters: [adapterHref],
    };

    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });

    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, 'adapter-touched'), 'utf8')).toBe('ok\n');
  });

  it('records error when adapter module cannot be loaded', async () => {
    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
      adapters: ['@bluetemberg/nonexistent-adapter-package-xyz'],
    };

    const results = await sync(root, { config, silent: true });
    expect(results.errors.some((e) => e.includes('adapter'))).toBe(true);
  });

  it('prune removes stale rule outputs when enabled', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'keep.md'), '---\ndescription: K\nscope: "**"\n---\n\n# K\n');
    writeFileSync(join(root, 'llm', 'rules', 'drop.md'), '---\ndescription: D\nscope: "**"\n---\n\n# D\n');

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.cursor', 'rules', 'keep.mdc'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'rules', 'drop.mdc'))).toBe(true);

    rmSync(join(root, 'llm', 'rules', 'drop.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.cursor', 'rules', 'keep.mdc'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'rules', 'drop.mdc'))).toBe(false);
  });

  it('prune removes stale cursor agent outputs when enabled', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'keep.md'), '---\nname: keep\ndescription: K\n---\n\n# K\n');
    writeFileSync(join(root, 'llm', 'agents', 'drop.md'), '---\nname: drop\ndescription: D\n---\n\n# D\n');

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {
        agents: { cursor: { dir: '.cursor/agents', ext: '.md' } },
      },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.cursor', 'agents', 'keep.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'agents', 'drop.md'))).toBe(true);

    rmSync(join(root, 'llm', 'agents', 'drop.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.cursor', 'agents', 'keep.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'agents', 'drop.md'))).toBe(false);
  });

  it('does not prune in check mode even when prune option is true', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'keep.md'), '---\ndescription: K\nscope: "**"\n---\n\n# K\n');
    writeFileSync(join(root, 'llm', 'rules', 'drop.md'), '---\ndescription: D\nscope: "**"\n---\n\n# D\n');

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.cursor', 'rules', 'drop.mdc'))).toBe(true);

    rmSync(join(root, 'llm', 'rules', 'drop.md'));
    await sync(root, { config, silent: true, check: true, prune: true });

    expect(existsSync(join(root, '.cursor', 'rules', 'drop.mdc'))).toBe(true);
  });

  it('does not prune when sync recorded errors', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');
    writeFileSync(join(root, 'llm', 'hooks.json'), JSON.stringify({ hooks: { bad: 'x' } }));

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    await sync(root, { config, silent: true, prune: true });
    expect(existsSync(join(root, '.cursor', 'rules', 'r.mdc'))).toBe(true);
  });

  it('handles missing source directories gracefully', async () => {
    const config: BlueprintConfig = {
      platforms: ['cursor', 'claude', 'copilot'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
        agents: { claude: { dir: '.claude/agents', ext: '.md' } },
        skills: { claude: { dir: '.claude/skills' } },
      },
    };

    const results = await sync(root, { config, silent: true });
    expect(results.synced).toBe(0);
    expect(results.errors).toEqual([]);
  });
});

describe('loadConfig', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(root);
    expect(config.platforms).toEqual(['cursor', 'claude', 'copilot']);
    expect(config.source).toBe('llm');
    expect(config.targets.agents?.cursor).toEqual(DEFAULT_TARGETS.agents.cursor);
    expect(config.targets.skills?.cursor).toEqual(DEFAULT_TARGETS.skills.cursor);
  });

  it('reads bluetemberg.config.json when present', () => {
    const custom = { platforms: ['cursor'], source: 'ai', targets: {} };
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(custom));

    const config = loadConfig(root);
    expect(config.platforms).toEqual(['cursor']);
    expect(config.source).toBe('ai');
  });

  it('throws on malformed JSON', () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), '{ invalid json !!!');

    expect(() => loadConfig(root)).toThrow('Failed to parse');
  });

  it('throws on missing platforms array', () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify({ source: 'llm', targets: {} }));

    expect(() => loadConfig(root)).toThrow('"platforms" must be a non-empty array');
  });

  it('throws on empty platforms array', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: [], source: 'llm', targets: {} }),
    );

    expect(() => loadConfig(root)).toThrow('"platforms" must be a non-empty array');
  });

  it('throws on unknown platform', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor', 'vscode'], source: 'llm', targets: {} }),
    );

    expect(() => loadConfig(root)).toThrow('unknown platform(s): vscode');
  });

  it('throws on invalid adapters field', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 'llm', targets: {}, adapters: [1] }),
    );

    expect(() => loadConfig(root)).toThrow('"adapters" must be an array of strings');
  });

  it('throws when targets.rules entry omits ext', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['cursor'],
        source: 'llm',
        targets: { rules: { cursor: { dir: '.cursor/rules' } } },
      }),
    );

    expect(() => loadConfig(root)).toThrow('targets.rules.cursor.ext');
  });

  it('throws when targets uses unknown platform key', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['cursor'],
        source: 'llm',
        targets: { rules: { vscode: { dir: '.vscode', ext: '.md' } } },
      }),
    );

    expect(() => loadConfig(root)).toThrow('unknown platform in targets.rules');
  });

  it('throws when targets is not an object', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 'llm', targets: [] }),
    );

    expect(() => loadConfig(root)).toThrow('"targets" must be an object');
  });
});

describe('shouldExitWithFailure', () => {
  it('is true when errors are present', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 0, errors: ['e'] }, false)).toBe(true);
  });

  it('is false when no errors and not check drift', () => {
    expect(shouldExitWithFailure({ synced: 1, outOfSync: 0, errors: [] }, false)).toBe(false);
  });

  it('is true in check mode when out of sync', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 2, errors: [] }, true)).toBe(true);
  });

  it('is false when out of sync but not check mode', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 2, errors: [] }, false)).toBe(false);
  });

  it('is true when both errors and drift in check mode', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 1, errors: ['x'] }, true)).toBe(true);
  });
});
