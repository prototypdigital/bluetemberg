import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { parse as tomlParse } from 'smol-toml';
import { sync, loadConfig, shouldExitWithFailure } from '../src/sync/index.js';
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

  it('does not write cursor agent/skill files when cursor is not in platforms', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'sub.md'), '---\nname: sub\ndescription: S\n---\n\n# S\n');

    mkdirSync(join(root, 'llm', 'skills', 'my-skill'), { recursive: true });
    writeFileSync(join(root, 'llm', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n\n# S\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {
        agents: { claude: { dir: '.claude/agents', ext: '.md' } },
        skills: { claude: { dir: '.claude/skills' } },
      },
    };

    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.cursor', 'agents', 'sub.md'))).toBe(false);
    expect(existsSync(join(root, '.cursor', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
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

  it('check --diff prints a per-file diff of the changed lines', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'diff-test.md'),
      '---\ndescription: Diff\nscope: "**"\n---\n\n# Correct heading\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    // Generate the output, then hand-edit it to introduce drift the diff should surface.
    await sync(root, { config, silent: true });
    const outPath = join(root, '.cursor', 'rules', 'diff-test.mdc');
    writeFileSync(outPath, readFileSync(outPath, 'utf8').replace('# Correct heading', '# Stale heading'));

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    let results;
    try {
      results = await sync(root, { check: true, diff: true, config });
    } finally {
      spy.mockRestore();
    }
    const output = logs.join('\n');

    expect(results.outOfSync).toBe(1);
    expect(shouldExitWithFailure(results, true)).toBe(true);
    expect(output).toContain('OUT OF SYNC:');
    expect(output).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(output).toContain('-# Stale heading');
    expect(output).toContain('+# Correct heading');
  });

  it('check --diff honors --silent and leaves counts unchanged', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'silent-diff.md'),
      '---\ndescription: Silent\nscope: "**"\n---\n\n# Heading\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    let results;
    try {
      // Output never generated, so the file is out of sync; --silent suppresses the diff lines.
      results = await sync(root, { check: true, diff: true, silent: true, config });
    } finally {
      spy.mockRestore();
    }

    expect(results.outOfSync).toBe(1);
    expect(logs.join('\n')).toBe('');
  });

  it('check without --diff produces no diff output (no regression)', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'no-diff.md'),
      '---\ndescription: NoDiff\nscope: "**"\n---\n\n# Heading\n',
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: { rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } } },
    };

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    let results;
    try {
      results = await sync(root, { check: true, config });
    } finally {
      spy.mockRestore();
    }
    const output = logs.join('\n');

    expect(results.outOfSync).toBe(1);
    expect(output).toContain('OUT OF SYNC:');
    expect(output).not.toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(output).not.toContain('lines added');
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

  it('does not write copilot-instructions.md when copilot is not in platforms', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My Project\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(false);
  });

  it('syncs AGENTS.md to GEMINI.md when gemini is in platforms', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My Project\n\nProject docs.\n');

    const config: BlueprintConfig = {
      platforms: ['gemini'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });

    const geminiMd = readFileSync(join(root, 'GEMINI.md'), 'utf8');
    expect(geminiMd).toBe('# My Project\n\nProject docs.\n');
  });

  it('does not write GEMINI.md when gemini is not in platforms', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My Project\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(false);
  });

  it('does not write GEMINI.md when AGENTS.md does not exist', async () => {
    const config: BlueprintConfig = {
      platforms: ['gemini'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(false);
  });

  it('syncs rules to gemini platform', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'test-rule.md'),
      '---\ndescription: A test rule\nscope: "src/**"\n---\n\n# Test Rule\n',
    );

    const config: BlueprintConfig = {
      platforms: ['gemini'],
      source: 'llm',
      targets: {
        rules: { gemini: { dir: '.gemini/context', ext: '.md' } },
      },
    };

    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.gemini', 'context', 'test-rule.md'))).toBe(true);
    const content = readFileSync(join(root, '.gemini', 'context', 'test-rule.md'), 'utf8');
    expect(content).toContain('glob:');
    expect(content).toContain('src/**');
  });

  it('prune removes stale GEMINI.md singleton when AGENTS.md is removed', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');

    const config: BlueprintConfig = {
      platforms: ['gemini'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(true);

    rmSync(join(root, 'AGENTS.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, 'GEMINI.md'))).toBe(false);
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

  it('prune removes stale skill outputs when enabled', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'keep-skill'), { recursive: true });
    mkdirSync(join(root, 'llm', 'skills', 'drop-skill'), { recursive: true });
    writeFileSync(join(root, 'llm', 'skills', 'keep-skill', 'SKILL.md'), '---\nname: keep\n---\n\n# Keep\n');
    writeFileSync(join(root, 'llm', 'skills', 'drop-skill', 'SKILL.md'), '---\nname: drop\n---\n\n# Drop\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: { skills: { claude: { dir: '.claude/skills' } } },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.claude', 'skills', 'keep-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'drop-skill', 'SKILL.md'))).toBe(true);

    rmSync(join(root, 'llm', 'skills', 'drop-skill'), { recursive: true });
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.claude', 'skills', 'keep-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'drop-skill', 'SKILL.md'))).toBe(false);
  });

  it('prune removes stale commands from .claude/commands when enabled', async () => {
    mkdirSync(join(root, 'llm', 'commands'), { recursive: true });
    writeFileSync(join(root, 'llm', 'commands', 'keep.md'), '# Keep\n');
    writeFileSync(join(root, 'llm', 'commands', 'drop.md'), '# Drop\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.claude', 'commands', 'keep.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'commands', 'drop.md'))).toBe(true);

    rmSync(join(root, 'llm', 'commands', 'drop.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.claude', 'commands', 'keep.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'commands', 'drop.md'))).toBe(false);
  });

  it('prune removes stale prompts from .github/prompts when enabled', async () => {
    mkdirSync(join(root, 'llm', 'prompts'), { recursive: true });
    writeFileSync(join(root, 'llm', 'prompts', 'keep.md'), '# Keep\n');
    writeFileSync(join(root, 'llm', 'prompts', 'drop.md'), '# Drop\n');

    const config: BlueprintConfig = {
      platforms: ['copilot'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.github', 'prompts', 'keep.prompt.md'))).toBe(true);
    expect(existsSync(join(root, '.github', 'prompts', 'drop.prompt.md'))).toBe(true);

    rmSync(join(root, 'llm', 'prompts', 'drop.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.github', 'prompts', 'keep.prompt.md'))).toBe(true);
    expect(existsSync(join(root, '.github', 'prompts', 'drop.prompt.md'))).toBe(false);
  });

  it('prune removes stale copilot-instructions.md singleton when AGENTS.md is removed', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');

    const config: BlueprintConfig = {
      platforms: ['copilot'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true);

    rmSync(join(root, 'AGENTS.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(false);
  });

  it('prune removes stale mcp.json singletons when llm/mcp.json is removed', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['interactive'] }));

    const config: BlueprintConfig = {
      platforms: ['claude', 'copilot', 'cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.claude', 'mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.github', 'mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'mcp.json'))).toBe(true);

    rmSync(join(root, 'llm', 'mcp.json'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.claude', 'mcp.json'))).toBe(false);
    expect(existsSync(join(root, '.github', 'mcp.json'))).toBe(false);
    expect(existsSync(join(root, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('prune removes stale hooks.json when llm/hooks.json is removed', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'hooks.json'),
      JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: 'npm run lint' }] } }),
    );

    const config: BlueprintConfig = {
      platforms: ['cursor'],
      source: 'llm',
      targets: {},
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.cursor', 'hooks.json'))).toBe(true);

    rmSync(join(root, 'llm', 'hooks.json'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('prune removes stale marketplace skill when source skill is removed', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'keep-skill'), { recursive: true });
    mkdirSync(join(root, 'llm', 'skills', 'drop-skill'), { recursive: true });
    writeFileSync(join(root, 'llm', 'skills', 'keep-skill', 'SKILL.md'), '---\nname: keep\n---\n\n# Keep\n');
    writeFileSync(join(root, 'llm', 'skills', 'drop-skill', 'SKILL.md'), '---\nname: drop\n---\n\n# Drop\n');

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      marketplace: { plugins: [{ name: 'my-plugin' }] },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'plugins/my-plugin/skills/keep-skill/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/my-plugin/skills/drop-skill/SKILL.md'))).toBe(true);

    rmSync(join(root, 'llm', 'skills', 'drop-skill'), { recursive: true });
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, 'plugins/my-plugin/skills/keep-skill/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/my-plugin/skills/drop-skill/SKILL.md'))).toBe(false);
  });

  it('prune removes stale marketplace agent when source agent is removed', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'keep-agent.md'), '---\nname: keep\n---\n\n# Keep\n');
    writeFileSync(join(root, 'llm', 'agents', 'drop-agent.md'), '---\nname: drop\n---\n\n# Drop\n');

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      marketplace: { plugins: [{ name: 'my-plugin' }] },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'plugins/my-plugin/agents/keep-agent.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/my-plugin/agents/drop-agent.md'))).toBe(true);

    rmSync(join(root, 'llm', 'agents', 'drop-agent.md'));
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, 'plugins/my-plugin/agents/keep-agent.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/my-plugin/agents/drop-agent.md'))).toBe(false);
  });

  it('prune cleans up empty plugin directories when all content is removed', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'only-skill'), { recursive: true });
    writeFileSync(join(root, 'llm', 'skills', 'only-skill', 'SKILL.md'), '---\nname: only\n---\n\n# Only\n');

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      marketplace: { plugins: [{ name: 'my-plugin' }] },
    };

    await sync(root, { config, silent: true });
    expect(existsSync(join(root, 'plugins/my-plugin/skills/only-skill/SKILL.md'))).toBe(true);

    rmSync(join(root, 'llm', 'skills', 'only-skill'), { recursive: true });
    await sync(root, { config, silent: true, prune: true });

    expect(existsSync(join(root, 'plugins/my-plugin/skills/only-skill'))).toBe(false);
    expect(existsSync(join(root, 'plugins/my-plugin/skills'))).toBe(false);
    expect(existsSync(join(root, 'plugins/my-plugin'))).toBe(false);
    expect(existsSync(join(root, 'plugins'))).toBe(false);
  });

  it('prune handles missing output directories gracefully', async () => {
    const config: BlueprintConfig = {
      platforms: ['cursor', 'claude', 'copilot'],
      source: 'llm',
      targets: {
        rules: { cursor: { dir: '.cursor/rules', ext: '.mdc' } },
        agents: { claude: { dir: '.claude/agents', ext: '.md' } },
        skills: { claude: { dir: '.claude/skills' } },
      },
    };

    const results = await sync(root, { config, silent: true, prune: true });
    expect(results.errors).toEqual([]);
    expect(results.synced).toBe(0);
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
    expect(config.targets.agents?.cursor).toEqual({ dir: '.cursor/agents', ext: '.md' });
    expect(config.targets.skills?.cursor).toEqual({ dir: '.cursor/skills' });
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

  it('throws on a malformed stack version pin (instead of silently hard-excluding)', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm', targets: {}, stacks: { react: '15.x.0' } }),
    );

    expect(() => loadConfig(root)).toThrow('stacks.react must be "auto" or a valid semver');
  });

  it('accepts valid stack pins and the "auto" sentinel', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['claude'],
        source: 'llm',
        targets: {},
        stacks: { react: '15.2.0', payload: 'auto', nextjs: '>=13.4' },
      }),
    );

    expect(() => loadConfig(root)).not.toThrow();
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

  it('throws when source is not a string', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 42, targets: {} }),
    );

    expect(() => loadConfig(root)).toThrow('"source" must be a string');
  });

  it('throws when targets.rules.cursor.dir is empty string', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['cursor'],
        source: 'llm',
        targets: { rules: { cursor: { dir: '', ext: '.mdc' } } },
      }),
    );

    expect(() => loadConfig(root)).toThrow('targets.rules.cursor.dir must be a non-empty string');
  });

  it('throws when a targets section entry is not an object', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['cursor'],
        source: 'llm',
        targets: { rules: { cursor: 'invalid' } },
      }),
    );

    expect(() => loadConfig(root)).toThrow('targets.rules.cursor must be an object');
  });

  it('throws when targets.agents entry omits ext', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['claude'],
        source: 'llm',
        targets: { agents: { claude: { dir: '.claude/agents' } } },
      }),
    );

    expect(() => loadConfig(root)).toThrow('targets.agents.claude.ext');
  });

  it('accepts targets.skills without ext (SkillTargetConfig has no ext)', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['claude'],
        source: 'llm',
        targets: { skills: { claude: { dir: '.claude/skills' } } },
      }),
    );

    expect(() => loadConfig(root)).not.toThrow();
  });

  it('throws on non-object root config', () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), '"just-a-string"');

    expect(() => loadConfig(root)).toThrow('expected an object');
  });

  it('accepts a valid profile field', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm', profile: 'backend', targets: {} }),
    );

    expect(() => loadConfig(root)).not.toThrow();
  });

  it('accepts agentic as a valid profile field', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm', profile: 'agentic', targets: {} }),
    );

    expect(() => loadConfig(root)).not.toThrow();
  });

  it('throws on an unknown profile value', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm', profile: 'nope', targets: {} }),
    );

    expect(() => loadConfig(root)).toThrow('"profile" must be one of');
  });

  it('throws when the root field is not a boolean', () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 'llm', targets: {}, root: 'yes' }),
    );

    expect(() => loadConfig(root)).toThrow('"root" must be a boolean');
  });
});

describe('loadConfig: monorepo inheritance', () => {
  let monorepo: string;
  let pkg: string;

  function writeConfig(dir: string, config: Record<string, unknown>): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bluetemberg.config.json'), JSON.stringify(config));
  }

  beforeEach(() => {
    monorepo = createTmpDir();
    // A `.git` marker stops upward traversal at the monorepo root, isolating these tests.
    mkdirSync(join(monorepo, '.git'), { recursive: true });
    pkg = join(monorepo, 'packages', 'frontend');
    mkdirSync(pkg, { recursive: true });
  });

  afterEach(() => {
    rmSync(monorepo, { recursive: true, force: true });
  });

  it('merges a local config with an ancestor root config', () => {
    writeConfig(monorepo, { platforms: ['claude'], source: 'llm', targets: {} });
    writeConfig(pkg, { platforms: ['cursor'], targets: {} });

    const config = loadConfig(pkg);
    // platforms are unioned across the chain (ancestor first).
    expect(config.platforms).toEqual(['claude', 'cursor']);
  });

  it('lets local values win on conflict', () => {
    writeConfig(monorepo, {
      platforms: ['claude'],
      source: 'root-llm',
      profile: 'backend',
      targets: {},
    });
    writeConfig(pkg, { platforms: ['cursor'], profile: 'frontend', targets: {} });

    const config = loadConfig(pkg);
    expect(config.profile).toBe('frontend');
  });

  it('never inherits source — always uses the local value', () => {
    writeConfig(monorepo, { platforms: ['claude'], source: 'root-llm', targets: {} });
    writeConfig(pkg, { platforms: ['cursor'], source: 'pkg-llm', targets: {} });

    expect(loadConfig(pkg).source).toBe('pkg-llm');
  });

  it('does not inherit source when the local config omits it', () => {
    writeConfig(monorepo, { platforms: ['claude'], source: 'root-llm', targets: {} });
    writeConfig(pkg, { platforms: ['cursor'], targets: {} });

    // `source` is local-only; omitting it locally must not pull in the ancestor value.
    expect(loadConfig(pkg).source).toBeUndefined();
  });

  it('lets a local config inherit platforms from an ancestor', () => {
    writeConfig(monorepo, { platforms: ['claude', 'cursor'], source: 'llm', targets: {} });
    writeConfig(pkg, { source: 'llm', targets: {}, profile: 'frontend' });

    const config = loadConfig(pkg);
    expect(config.platforms).toEqual(['claude', 'cursor']);
    expect(config.profile).toBe('frontend');
  });

  it('deep-merges targets per platform, local fields winning', () => {
    writeConfig(monorepo, {
      platforms: ['claude', 'cursor'],
      source: 'llm',
      targets: {
        rules: {
          claude: { dir: '.claude/rules', ext: '.md' },
          cursor: { dir: '.cursor/rules', ext: '.mdc' },
        },
      },
    });
    writeConfig(pkg, {
      platforms: ['cursor'],
      targets: { rules: { cursor: { dir: '.cursor/custom' } } },
    });

    const config = loadConfig(pkg);
    // Untouched ancestor platform is preserved.
    expect(config.targets.rules?.claude).toEqual({ dir: '.claude/rules', ext: '.md' });
    // Overridden platform merges fields — local dir wins, ancestor ext survives.
    expect(config.targets.rules?.cursor).toEqual({ dir: '.cursor/custom', ext: '.mdc' });
  });

  it('merges extends with local entries taking priority and dedupes', () => {
    writeConfig(monorepo, {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
      extends: ['../shared', '../../'],
    });
    writeConfig(pkg, { platforms: ['cursor'], targets: {}, extends: ['./local', '../../'] });

    const config = loadConfig(pkg);
    expect(config.extends).toEqual(['./local', '../../', '../shared']);
  });

  it('merges stacks and adapters across the chain', () => {
    writeConfig(monorepo, {
      platforms: ['claude'],
      source: 'llm',
      targets: {},
      stacks: { nextjs: 'auto', payload: '3.4.1' },
      adapters: ['@scope/base'],
    });
    writeConfig(pkg, {
      platforms: ['cursor'],
      targets: {},
      stacks: { nextjs: '15.0.0' },
      adapters: ['@scope/frontend', '@scope/base'],
    });

    const config = loadConfig(pkg);
    expect(config.stacks).toEqual({ nextjs: '15.0.0', payload: '3.4.1' });
    expect(config.adapters).toEqual(['@scope/frontend', '@scope/base']);
  });

  it('stops upward traversal at a config marked root: true', () => {
    // workspace/ carries root:true and must halt discovery before the monorepo-level config.
    const workspace = join(monorepo, 'workspace');
    const inner = join(workspace, 'pkg');
    writeConfig(monorepo, { platforms: ['gemini'], source: 'llm', targets: {} });
    writeConfig(workspace, { platforms: ['claude'], source: 'llm', targets: {}, root: true });
    writeConfig(inner, { platforms: ['cursor'], targets: {} });

    const config = loadConfig(inner);
    // 'gemini' from the monorepo root is above the root:true boundary and must be excluded.
    expect(config.platforms).toEqual(['claude', 'cursor']);
  });

  it('stops upward traversal at the git root', () => {
    // pkg/ has no config and no platforms anywhere below .git → falls through to the monorepo root,
    // but discovery must not climb past the .git marker into any real ancestor config.
    writeConfig(monorepo, { platforms: ['claude'], source: 'llm', targets: {} });

    expect(loadConfig(pkg).platforms).toEqual(['claude']);
  });

  it('returns a stand-alone local config unchanged when no ancestor exists', () => {
    writeConfig(pkg, { platforms: ['cursor'], source: 'pkg-llm', targets: {} });
    rmSync(join(monorepo, 'bluetemberg.config.json'), { force: true });

    const config = loadConfig(pkg);
    expect(config.platforms).toEqual(['cursor']);
    expect(config.source).toBe('pkg-llm');
  });

  it('throws when no config in the chain supplies platforms', () => {
    writeConfig(monorepo, { source: 'llm', targets: {} });
    writeConfig(pkg, { source: 'llm', targets: {} });

    expect(() => loadConfig(pkg)).toThrow('"platforms" must be a non-empty array');
  });
});

describe('shouldExitWithFailure', () => {
  it('is true when errors are present', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 0, errors: ['e'], warnings: [] }, false)).toBe(true);
  });

  it('is false when no errors and not check drift', () => {
    expect(shouldExitWithFailure({ synced: 1, outOfSync: 0, errors: [], warnings: [] }, false)).toBe(false);
  });

  it('is true in check mode when out of sync', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 2, errors: [], warnings: [] }, true)).toBe(true);
  });

  it('is false when out of sync but not check mode', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 2, errors: [], warnings: [] }, false)).toBe(false);
  });

  it('is true when both errors and drift in check mode', () => {
    expect(shouldExitWithFailure({ synced: 0, outOfSync: 1, errors: ['x'], warnings: [] }, true)).toBe(true);
  });
});

describe('extends: source merging', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs rules from an extended source directory', async () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(shared, 'llm', 'rules', 'shared-rule.md'),
      '---\ndescription: Shared\nscope: "**"\n---\n\n# Shared Rule\n',
    );

    const pkg = join(root, 'pkg');
    mkdirSync(join(pkg, 'llm'), { recursive: true }); // local source exists but no rules

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['../shared'],
      targets: { rules: { claude: { dir: '.claude/rules', ext: '.md' } } },
    };

    const results = await sync(pkg, { config, silent: true });

    expect(results.errors).toHaveLength(0);
    expect(existsSync(join(pkg, '.claude', 'rules', 'shared-rule.md'))).toBe(true);
  });

  it('local rules take priority over extended rules with the same filename', async () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(shared, 'llm', 'rules', 'same-rule.md'),
      '---\ndescription: Extended\nscope: "**"\n---\n\n# Extended version\n',
    );

    const pkg = join(root, 'pkg');
    mkdirSync(join(pkg, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(pkg, 'llm', 'rules', 'same-rule.md'),
      '---\ndescription: Local\nscope: "**"\n---\n\n# Local version\n',
    );

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['../shared'],
      targets: { rules: { claude: { dir: '.claude/rules', ext: '.md' } } },
    };

    await sync(pkg, { config, silent: true });

    const content = readFileSync(join(pkg, '.claude', 'rules', 'same-rule.md'), 'utf8');
    expect(content).toContain('Local version');
    expect(content).not.toContain('Extended version');
  });

  it('merges local and extended rules — both appear in output', async () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(shared, 'llm', 'rules', 'base-rule.md'),
      '---\ndescription: Base\nscope: "**"\n---\n\n# Base\n',
    );

    const pkg = join(root, 'pkg');
    mkdirSync(join(pkg, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(pkg, 'llm', 'rules', 'local-rule.md'),
      '---\ndescription: Local\nscope: "**"\n---\n\n# Local\n',
    );

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['../shared'],
      targets: { rules: { claude: { dir: '.claude/rules', ext: '.md' } } },
    };

    const results = await sync(pkg, { config, silent: true });

    expect(results.synced).toBe(2);
    expect(existsSync(join(pkg, '.claude', 'rules', 'local-rule.md'))).toBe(true);
    expect(existsSync(join(pkg, '.claude', 'rules', 'base-rule.md'))).toBe(true);
  });

  it('rejects invalid extends value in config validation', () => {
    expect(() =>
      loadConfig(
        (() => {
          // Write a temp config with invalid extends
          const tmpRoot = join(root, 'invalid-extends');
          mkdirSync(tmpRoot, { recursive: true });
          writeFileSync(
            join(tmpRoot, 'bluetemberg.config.json'),
            JSON.stringify({ platforms: ['claude'], source: 'llm', extends: 42 }),
          );
          return tmpRoot;
        })(),
      ),
    ).toThrow('"extends" must be a string or array of strings');
  });

  it('emits a warning (not an error) when an extends entry cannot be resolved', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['./nonexistent-source'],
      targets: {},
    };

    const results = await sync(root, { config, silent: true });
    expect(results.errors).toHaveLength(0);
    expect(results.warnings).toHaveLength(1);
    expect(results.warnings[0]).toContain('./nonexistent-source');
    expect(results.warnings[0]).toContain('could not be resolved');
  });

  it('warnings do not cause shouldExitWithFailure to return true', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['./nonexistent'],
      targets: {},
    };

    const results = await sync(root, { config, silent: true });
    expect(shouldExitWithFailure(results, false)).toBe(false);
  });

  it('verbose mode does not suppress normal output or cause errors', async () => {
    const shared = join(root, 'shared');
    mkdirSync(join(shared, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(shared, 'llm', 'rules', 'shared-rule.md'),
      '---\ndescription: Shared\nscope: "**"\n---\n\n# Shared\n',
    );

    const pkg = join(root, 'pkg');
    mkdirSync(join(pkg, 'llm'), { recursive: true });

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['../shared'],
      targets: { rules: { claude: { dir: '.claude/rules', ext: '.md' } } },
    };

    const results = await sync(pkg, { config, silent: true, verbose: true });
    expect(results.errors).toHaveLength(0);
    expect(results.warnings).toHaveLength(0);
    expect(results.synced).toBe(1);
  });
});

describe('guardrails sync', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeGuardrail(id: string, content: string): void {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', `${id}.md`), content);
  }

  const VALID_GUARDRAIL = `---
description: Test guardrail
trigger: EnterWorktree
hook_type: PreToolUse
check:
  field: name
  not_empty: true
  not_matches: "^claude/"
message: "Branch name required"
---

# Test
`;

  it('writes .claude/settings.json with PreToolUse hook when claude is in platforms', async () => {
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const settingsPath = join(root, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0].matcher).toBe('EnterWorktree');
    expect(preToolUse[0].hooks[0].type).toBe('command');
    expect(String(preToolUse[0].hooks[0].command)).toContain('jq');
  });

  it('generated command contains the not_matches pattern', async () => {
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    const command = String(settings.hooks.PreToolUse[0].hooks[0].command);
    expect(command).toContain('^claude/');
  });

  it('does not write settings.json when no llm/guardrails/ directory exists', async () => {
    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('does not write settings.json when claude is not in platforms', async () => {
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['cursor'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('preserves existing non-hooks settings keys when merging', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ extraKnownMarketplaces: ['owner/repo'] }, null, 2),
    );
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.extraKnownMarketplaces).toEqual(['owner/repo']);
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
  });

  it('regenerates hooks section idempotently on repeated sync runs', async () => {
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });
    await sync(root, { config, silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('records an error for guardrail files with invalid frontmatter', async () => {
    writeGuardrail('bad-guardrail', '---\ndescription: Missing required fields\n---\n\n# Bad\n');

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.includes('bad-guardrail'))).toBe(true);
  });

  it('syncs guardrails from extended source dirs (pack layout)', async () => {
    const packDir = join(root, 'shared-pack', 'llm', 'guardrails');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'pack-guardrail.md'), VALID_GUARDRAIL);

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['./shared-pack'],
      targets: {},
    };
    await sync(root, { config, silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('EnterWorktree');
  });

  it('local guardrail overrides an extended one with the same filename', async () => {
    const packDir = join(root, 'shared-pack', 'llm', 'guardrails');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, 'same-name.md'),
      VALID_GUARDRAIL.replace('trigger: EnterWorktree', 'trigger: PackTool'),
    );
    writeGuardrail('same-name', VALID_GUARDRAIL);

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      extends: ['./shared-pack'],
      targets: {},
    };
    await sync(root, { config, silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('EnterWorktree');
  });

  it('rejects a guardrail whose field contains shell metacharacters', async () => {
    const marker = join(root, 'PWNED_FIELD');
    writeGuardrail(
      'evil-field',
      [
        '---',
        'description: evil',
        'trigger: EnterWorktree',
        'hook_type: PreToolUse',
        'check:',
        `  field: ${JSON.stringify(`x'; touch ${marker} #`)}`,
        '  not_empty: true',
        'message: nope',
        '---',
        '',
        '# Evil',
      ].join('\n'),
    );

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    // Field fails the SAFE_FIELD charset → invalid frontmatter → no hook generated.
    expect(results.errors.some((e) => e.includes('evil-field'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('does not let a hostile message/regex break out when the generated hook runs', async () => {
    const marker = join(root, 'PWNED_RUN');
    // Classic single-quote breakout payload in both the message and the regex.
    const payload = `'; touch ${marker}; echo '`;
    writeGuardrail(
      'evil-run',
      [
        '---',
        'description: evil',
        'trigger: EnterWorktree',
        'hook_type: PreToolUse',
        'check:',
        '  field: name',
        '  not_empty: true',
        `  not_matches: ${JSON.stringify(`$(touch ${marker})`)}`,
        `message: ${JSON.stringify(payload)}`,
        '---',
        '',
        '# Evil',
      ].join('\n'),
    );

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const command = String(
      JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse[0].hooks[0]
        .command,
    );

    // Execute the stored command exactly as a shell would. Empty field input fires the
    // not_empty branch, which prints the message verbatim and exits 2.
    let stdout = '';
    try {
      stdout = execSync(command, { input: '{}', encoding: 'utf8' });
    } catch (err) {
      stdout = String((err as { stdout?: string }).stdout ?? '');
    }

    expect(existsSync(marker)).toBe(false); // neither payload executed
    expect(stdout).toContain('; touch'); // message printed as literal data
  });

  it('rejects a guardrail whose condition regex is not valid POSIX ERE', async () => {
    // A JS lookahead does not compile as ERE. Before GHSA-grpx-fj8v-q8g9 this synced
    // cleanly and produced a hook that never fired.
    writeGuardrail(
      'bad-regex',
      VALID_GUARDRAIL.replace('not_matches: "^claude/"', 'not_matches: "(?!claude/)"'),
    );

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.includes('bad-regex') && e.includes('POSIX ERE'))).toBe(true);
    expect(readPreToolUseHooks()).toHaveLength(0);
  });

  it('rejects a JS-idiom regex that compiles as ERE but checks the wrong thing', async () => {
    // `\d` is not a digit class in ERE: BSD libc compiles it to a literal `d`, so this
    // pattern compiles and then silently never matches. No runtime check can catch that,
    // because nothing failed — only refusing the idiom at its source can.
    writeGuardrail('js-idiom', VALID_GUARDRAIL.replace('not_matches: "^claude/"', "not_matches: '\\d+'"));

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.includes('js-idiom') && e.includes('[[:digit:]]'))).toBe(true);
    expect(readPreToolUseHooks()).toHaveLength(0);
  });

  it('generated hook blocks rather than allows when its regex fails to compile', async () => {
    writeGuardrail('test-guardrail', VALID_GUARDRAIL);

    const config: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const generated = String(readPreToolUseHooks()[0].hooks[0].command);
    const input = JSON.stringify({ name: 'feat/branch' });

    // Baseline: a name that satisfies the condition is allowed, so a non-zero exit below is
    // the malformed regex being caught and not the guardrail simply denying everything.
    expect(runHook(generated, input)).toBe(0);

    // Sync now refuses to emit a non-compiling pattern, so substitute one into the shipped
    // command — the hand-edited settings.json and different-libc cases the runtime check
    // exists for. `[[ =~ ]]` returns 2, not 1, on a pattern that fails to compile; read
    // through an `&&` chain that status was falsey and the hook exited 0, allowing the call.
    for (const bad of ['[', '(?!x)', 'a{3,2}', '*x']) {
      const command = generated.replace(`'^claude/'`, `'${bad}'`);
      expect(command).not.toBe(generated);
      expect(runHook(command, input), `not_matches=${bad} must block, not allow`).toBe(2);
    }
  });

  /** PreToolUse entries in the generated settings.json, or `[]` when none were written. */
  function readPreToolUseHooks(): { hooks: { command: string }[] }[] {
    const settingsPath = join(root, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return [];
    return JSON.parse(readFileSync(settingsPath, 'utf8')).hooks?.PreToolUse ?? [];
  }

  /** Exit code of a generated hook command run exactly as Claude Code would run it. */
  function runHook(command: string, input: string): number {
    try {
      execSync(command, { input, encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (err) {
      return (err as { status?: number }).status ?? -1;
    }
  }
});

describe('claude hooks sync', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const CLAUDE_CONFIG: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };

  const VALID_MANIFEST = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: './scripts/after-bash.sh', timeout: 30 }],
        },
      ],
      SessionEnd: [{ hooks: [{ type: 'command', command: './scripts/retro.sh' }] }],
    },
  };

  function writeManifest(doc: unknown, dir = join(root, 'llm')): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'hooks.claude.json'), JSON.stringify(doc, null, 2));
  }

  interface SettingsShape {
    hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
    extraKnownMarketplaces?: string[];
  }

  function readSettings(): SettingsShape {
    return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as SettingsShape;
  }

  const GUARDRAIL = `---
description: Test guardrail
trigger: EnterWorktree
hook_type: PreToolUse
check:
  field: name
  not_empty: true
message: "Branch name required"
---

# Test
`;

  it('writes llm/hooks.claude.json hooks into .claude/settings.json', async () => {
    writeManifest(VALID_MANIFEST);

    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const settings = readSettings();
    expect(settings.hooks.PostToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/after-bash.sh', timeout: 30 }] },
    ]);
    expect(settings.hooks.SessionEnd).toEqual([
      { hooks: [{ type: 'command', command: './scripts/retro.sh' }] },
    ]);
  });

  it('rejects a manifest with a non-whitelisted event', async () => {
    writeManifest({
      hooks: { Notification: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    });

    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(results.errors.some((e) => e.includes('Notification') && e.includes('hooks.claude.json'))).toBe(
      true,
    );
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('rejects a manifest with a non-command hook type', async () => {
    writeManifest({ hooks: { Stop: [{ hooks: [{ type: 'prompt', command: 'echo hi' }] }] } });

    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(results.errors.some((e) => e.includes('only "type": "command"'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('skips a pack-contributed hooks.claude.json with a warning (security boundary)', async () => {
    writeManifest(VALID_MANIFEST, join(root, 'shared-pack', 'llm'));

    const config: BlueprintConfig = { ...CLAUDE_CONFIG, extends: ['./shared-pack'] };
    const results = await sync(root, { config, silent: true });

    expect(results.errors).toEqual([]);
    expect(results.warnings.some((w) => w.includes('hooks.claude.json') && w.includes('shared-pack'))).toBe(
      true,
    );
    // The pack's hooks are never written anywhere.
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  it('local manifest is honored while a pack-contributed one is skipped', async () => {
    writeManifest(VALID_MANIFEST);
    writeManifest(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'evil' }] }] } },
      join(root, 'shared-pack', 'llm'),
    );

    const config: BlueprintConfig = { ...CLAUDE_CONFIG, extends: ['./shared-pack'] };
    const results = await sync(root, { config, silent: true });

    expect(results.warnings.some((w) => w.includes('shared-pack'))).toBe(true);
    const settings = readSettings();
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it('coexists with guardrails: guardrail entries first, project entries appended', async () => {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', 'test-guardrail.md'), GUARDRAIL);
    writeManifest({
      hooks: {
        PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: './scripts/pre-write.sh' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: './scripts/retro.sh' }] }],
      },
    });

    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const settings = readSettings();
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('EnterWorktree'); // guardrail first
    expect(String(settings.hooks.PreToolUse[0].hooks[0].command)).toContain('jq');
    expect(settings.hooks.PreToolUse[1].matcher).toBe('Write'); // project entry appended
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });

  it('an invalid manifest does not clobber guardrail hooks already in settings.json', async () => {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', 'test-guardrail.md'), GUARDRAIL);
    await sync(root, { config: CLAUDE_CONFIG, silent: true });
    const before = readSettings();

    writeFileSync(join(root, 'llm', 'hooks.claude.json'), 'not json');
    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(results.errors.some((e) => e.includes('hooks.claude.json'))).toBe(true);
    expect(readSettings()).toEqual(before);
  });

  it('does not write settings.json when claude is not in platforms', async () => {
    writeManifest(VALID_MANIFEST);

    const config: BlueprintConfig = { platforms: ['cursor'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(root, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('preserves hand-written hooks when neither guardrails nor a manifest exist', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    const handWritten = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
    };
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(handWritten, null, 2));

    await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(readSettings()).toEqual(handWritten);
  });

  it('preserves non-hooks settings keys when writing', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ extraKnownMarketplaces: ['owner/repo'] }, null, 2),
    );
    writeManifest(VALID_MANIFEST);

    await sync(root, { config: CLAUDE_CONFIG, silent: true });

    const settings = readSettings();
    expect(settings.extraKnownMarketplaces).toEqual(['owner/repo']);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it('clears a previously managed hooks key when the manifest empties out', async () => {
    writeManifest(VALID_MANIFEST);
    await sync(root, { config: CLAUDE_CONFIG, silent: true });
    expect(readSettings().hooks).toBeDefined();

    writeManifest({ hooks: {} });
    await sync(root, { config: CLAUDE_CONFIG, silent: true });

    expect(readSettings().hooks).toBeUndefined();
  });

  it('is idempotent and clean in check mode after a sync', async () => {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', 'test-guardrail.md'), GUARDRAIL);
    writeManifest(VALID_MANIFEST);

    await sync(root, { config: CLAUDE_CONFIG, silent: true });
    const results = await sync(root, { config: CLAUDE_CONFIG, silent: true, check: true });

    expect(results.errors).toEqual([]);
    expect(results.outOfSync).toBe(0);
  });
});

describe('codex sync', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs skills to .agents/skills (vendor-neutral)', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'my-skill'), { recursive: true });
    const skill = '---\nname: my-skill\ndescription: Does things\n---\n\n# My Skill\n';
    writeFileSync(join(root, 'llm', 'skills', 'my-skill', 'SKILL.md'), skill);

    const config: BlueprintConfig = {
      platforms: ['codex'],
      source: 'llm',
      targets: { skills: { codex: { dir: '.agents/skills' } } },
    };

    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(skill);
  });

  it('folds rules into a managed block in AGENTS.md, preserving hand-authored content', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My Project\n\nHand-authored guidance.\n');
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'global.md'),
      '---\ndescription: G\nscope: "**"\n---\n\n# Global Rule\n\nAlways do X.\n',
    );
    writeFileSync(
      join(root, 'llm', 'rules', 'scoped.md'),
      '---\ndescription: S\nscope: "src/**"\n---\n\n# Scoped Rule\n',
    );

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# My Project');
    expect(agents).toContain('Hand-authored guidance.');
    expect(agents).toContain('BEGIN BLUETEMBERG MANAGED RULES');
    expect(agents).toContain('# Global Rule');
    expect(agents).toContain('Always do X.');
    expect(agents).toContain('Applies to: `src/**`');
    expect(agents.indexOf('Hand-authored')).toBeLessThan(agents.indexOf('BEGIN BLUETEMBERG'));
  });

  it('creates AGENTS.md from scratch when none exists', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('# R');
  });

  it('rules block is idempotent (check mode clean after sync)', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });
    const results = await sync(root, { check: true, config, silent: true });
    expect(results.outOfSync).toBe(0);
  });

  it('removes the rules block when all rules are deleted, keeping hand-authored content', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n\nKeep me.\n');
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('BEGIN BLUETEMBERG MANAGED RULES');

    rmSync(join(root, 'llm', 'rules', 'r.md'));
    await sync(root, { config, silent: true });

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Keep me.');
    expect(agents).not.toContain('BEGIN BLUETEMBERG MANAGED RULES');
  });

  it('emits one .codex/agents/<name>.toml per agent with developer_instructions', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'agents', 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviews PRs\n---\n\nReview like an owner.\nNever modify files.\n',
    );

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const parsed = tomlParse(readFileSync(join(root, '.codex', 'agents', 'reviewer.toml'), 'utf8')) as {
      name: string;
      description: string;
      developer_instructions: string;
    };
    expect(parsed.name).toBe('reviewer');
    expect(parsed.description).toBe('Reviews PRs');
    expect(parsed.developer_instructions).toContain('Review like an owner.');
    expect(parsed.developer_instructions).toContain('Never modify files.');
  });

  it('falls back to the filename when an agent omits a name', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'helper.md'), '---\ndescription: H\n---\n\nBody.\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const parsed = tomlParse(readFileSync(join(root, '.codex', 'agents', 'helper.toml'), 'utf8')) as {
      name: string;
    };
    expect(parsed.name).toBe('helper');
  });

  it('writes MCP servers as a [mcp_servers.*] block in .codex/config.toml', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'mcp.json'),
      JSON.stringify({
        servers: ['interactive', { id: 'docs', type: 'http', url: 'https://docs.example/mcp' }],
      }),
    );

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const raw = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
    expect(raw).toContain('BEGIN BLUETEMBERG MANAGED MCP SERVERS');
    const parsed = tomlParse(raw) as {
      mcp_servers: Record<string, { command?: string; args?: string[]; url?: string }>;
    };
    expect(parsed.mcp_servers.interactive.command).toBe('npx');
    expect(parsed.mcp_servers.interactive.args).toContain('-y');
    expect(parsed.mcp_servers.docs.url).toBe('https://docs.example/mcp');
  });

  it('preserves hand-authored content in .codex/config.toml', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex', 'config.toml'), 'model = "gpt-5.3-codex"\n');
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['interactive'] }));

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });

    const parsed = tomlParse(readFileSync(join(root, '.codex', 'config.toml'), 'utf8')) as {
      model: string;
      mcp_servers: Record<string, unknown>;
    };
    expect(parsed.model).toBe('gpt-5.3-codex');
    expect(parsed.mcp_servers.interactive).toBeDefined();
  });

  it('keeps the Codex rules block out of copilot-instructions.md and GEMINI.md', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'r.md'),
      '---\ndescription: R\nscope: "**"\n---\n\n# R rule body\n',
    );

    const config: BlueprintConfig = {
      platforms: ['codex', 'copilot', 'gemini'],
      source: 'llm',
      targets: {
        rules: {
          copilot: { dir: '.github/instructions', ext: '.instructions.md' },
          gemini: { dir: '.gemini/context', ext: '.md' },
        },
      },
    };
    await sync(root, { config, silent: true });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('BEGIN BLUETEMBERG MANAGED RULES');
    expect(readFileSync(join(root, '.github', 'copilot-instructions.md'), 'utf8')).not.toContain(
      'BEGIN BLUETEMBERG MANAGED RULES',
    );
    expect(readFileSync(join(root, 'GEMINI.md'), 'utf8')).not.toContain('BEGIN BLUETEMBERG MANAGED RULES');
  });

  it('refuses to sync an AGENTS.md with an unpaired end marker, instead of appending forever', async () => {
    const broken = '# My file\n\n<!-- END BLUETEMBERG MANAGED RULES -->\n';
    writeFileSync(join(root, 'AGENTS.md'), broken);
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };

    const first = await sync(root, { config, silent: true });
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain('AGENTS.md');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(broken);

    // The old behaviour appended a fresh block on every pass; the file must not grow.
    const second = await sync(root, { config, silent: true });
    expect(second.errors).toHaveLength(1);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(broken);
  });

  it('collapses duplicated rules blocks so --check converges', async () => {
    const dup = [
      '# My file',
      '',
      '<!-- BEGIN BLUETEMBERG MANAGED RULES -->',
      'stale a',
      '<!-- END BLUETEMBERG MANAGED RULES -->',
      '',
      'Hand-authored middle.',
      '',
      '<!-- BEGIN BLUETEMBERG MANAGED RULES -->',
      'stale b',
      '<!-- END BLUETEMBERG MANAGED RULES -->',
      '',
    ].join('\n');
    writeFileSync(join(root, 'AGENTS.md'), dup);
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });
    expect(results.errors).toHaveLength(0);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents.match(/BEGIN BLUETEMBERG MANAGED RULES/g)).toHaveLength(1);
    expect(agents).toContain('Hand-authored middle.');
    expect(agents).not.toContain('stale a');
    expect(agents).not.toContain('stale b');

    const check = await sync(root, { check: true, config, silent: true });
    expect(check.outOfSync).toBe(0);
  });

  it('reports a malformed .codex/config.toml MCP block instead of duplicating it', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    const broken = 'model = "gpt-5"\n\n# END BLUETEMBERG MANAGED MCP SERVERS\n';
    writeFileSync(join(root, '.codex', 'config.toml'), broken);
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['interactive'] }));

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.includes('config.toml'))).toBe(true);
    expect(readFileSync(join(root, '.codex', 'config.toml'), 'utf8')).toBe(broken);
  });

  it('refuses a rule that quotes a managed-block marker, naming the rule and leaving AGENTS.md alone', async () => {
    const head = '# Head\n';
    writeFileSync(join(root, 'AGENTS.md'), head);
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'conventions.md'),
      '---\ndescription: C\nscope: "**"\n---\n\n' +
        'Never hand-edit between <!-- BEGIN BLUETEMBERG MANAGED RULES --> and\n' +
        '<!-- END BLUETEMBERG MANAGED RULES --> — run sync instead.\n',
    );

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };

    const first = await sync(root, { config, silent: true });
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]).toContain('rules/conventions.md');
    // Never written, so no later run can find an unpairable block on disk.
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(head);

    const second = await sync(root, { config, silent: true });
    expect(second.errors).toHaveLength(1);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(head);

    // Removing the offending rule heals it — no hand-editing of AGENTS.md required.
    rmSync(join(root, 'llm', 'rules', 'conventions.md'));
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');
    const third = await sync(root, { config, silent: true });
    expect(third.errors).toHaveLength(0);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('# R');
  });

  it('does not leak a duplicated rules block into copilot-instructions.md or GEMINI.md', async () => {
    const dup = [
      '# Head',
      '',
      '<!-- BEGIN BLUETEMBERG MANAGED RULES -->',
      'generated a',
      '<!-- END BLUETEMBERG MANAGED RULES -->',
      '',
      'Hand-authored middle.',
      '',
      '<!-- BEGIN BLUETEMBERG MANAGED RULES -->',
      'generated b',
      '<!-- END BLUETEMBERG MANAGED RULES -->',
      '',
    ].join('\n');
    writeFileSync(join(root, 'AGENTS.md'), dup);
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');

    const config: BlueprintConfig = {
      platforms: ['codex', 'copilot', 'gemini'],
      source: 'llm',
      targets: {
        rules: {
          copilot: { dir: '.github/instructions', ext: '.instructions.md' },
          gemini: { dir: '.gemini/context', ext: '.md' },
        },
      },
    };
    const results = await sync(root, { config, silent: true });
    expect(results.errors).toHaveLength(0);

    for (const derived of [join(root, '.github', 'copilot-instructions.md'), join(root, 'GEMINI.md')]) {
      const content = readFileSync(derived, 'utf8');
      expect(content).not.toContain('BLUETEMBERG MANAGED RULES');
      expect(content).not.toContain('generated a');
      expect(content).not.toContain('generated b');
      expect(content).toContain('# Head');
      expect(content).toContain('Hand-authored middle.');
    }
  });

  it('still reports a malformed AGENTS.md when there are no rules to inject', async () => {
    const broken = '# Head\n\n<!-- END BLUETEMBERG MANAGED RULES -->\n';
    writeFileSync(join(root, 'AGENTS.md'), broken);

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    const results = await sync(root, { config, silent: true });

    expect(results.errors.some((e) => e.includes('AGENTS.md'))).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(broken);
  });

  it('does not write Codex outputs when codex is not in platforms', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Project\n');
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\n# R\n');
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'a.md'), '---\nname: a\ndescription: A\n---\n\nBody\n');

    const config: BlueprintConfig = {
      platforms: ['claude'],
      source: 'llm',
      targets: { rules: { claude: { dir: '.claude/rules', ext: '.md' } } },
    };
    await sync(root, { config, silent: true });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).not.toContain('BEGIN BLUETEMBERG MANAGED RULES');
    expect(existsSync(join(root, '.codex', 'agents', 'a.toml'))).toBe(false);
  });

  it('prunes stale .codex/agents/*.toml when a source agent is removed', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'keep.md'), '---\nname: keep\ndescription: K\n---\n\nKeep\n');
    writeFileSync(join(root, 'llm', 'agents', 'drop.md'), '---\nname: drop\ndescription: D\n---\n\nDrop\n');

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { config, silent: true });
    expect(existsSync(join(root, '.codex', 'agents', 'keep.toml'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'agents', 'drop.toml'))).toBe(true);

    rmSync(join(root, 'llm', 'agents', 'drop.md'));
    await sync(root, { config, silent: true, prune: true });
    expect(existsSync(join(root, '.codex', 'agents', 'keep.toml'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'agents', 'drop.toml'))).toBe(false);
  });

  it('check mode does not create .codex/ directories on disk', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'a.md'), '---\nname: a\ndescription: A\n---\n\nBody\n');
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['interactive'] }));

    const config: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };
    await sync(root, { check: true, config, silent: true });

    expect(existsSync(join(root, '.codex'))).toBe(false);
  });
});
