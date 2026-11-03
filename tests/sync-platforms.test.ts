import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig, Platform } from '../src/types.js';
import { installFakePack } from './helpers/installed-pack.js';

// #281: a pack (catalog `platforms`) or a file (`platforms:` frontmatter) limited to some platforms
// gets no output for the others; everything else syncs as before.

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-sync-platforms-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCatalog(root: string, packs: unknown[]): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-11-03T00:00:00.000Z', packs }),
  );
}

function catalogPack(name: string, kind: string, items: string[], platforms?: string[]): unknown {
  return {
    name,
    version: '0.1.0',
    description: '',
    kind,
    universal: true,
    profiles: [],
    [kind]: items,
    ...(platforms ? { platforms } : {}),
    preview: '',
  };
}

function writeMd(dir: string, kind: string, name: string, frontmatter = ''): void {
  mkdirSync(join(dir, kind), { recursive: true });
  writeFileSync(
    join(dir, kind, `${name}.md`),
    `---\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeSkill(dir: string, name: string, frontmatter = ''): void {
  mkdirSync(join(dir, 'skills', name), { recursive: true });
  writeFileSync(
    join(dir, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function config(platforms: Platform[], extra: Partial<BlueprintConfig> = {}): BlueprintConfig {
  return { platforms, source: 'llm', targets: {}, ...extra };
}

describe('sync — pack platform routing', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const has = (path: string): boolean => existsSync(join(root, path));

  /** A Claude Code–only agent pack and an unrestricted agent pack, both installed. */
  function installAgentPacks(): void {
    writeMd(installFakePack(root, 'bluetemberg-agents-pr-reviewer'), 'agents', 'pr-reviewer');
    writeMd(installFakePack(root, 'bluetemberg-agents-docs'), 'agents', 'docs-maintainer');
    writeCatalog(root, [
      catalogPack('bluetemberg-agents-pr-reviewer', 'agents', ['pr-reviewer'], ['claude']),
      catalogPack('bluetemberg-agents-docs', 'agents', ['docs-maintainer'], []),
    ]);
  }

  it('skips only the other platforms’ output for a pack limited by its catalog platforms', async () => {
    installAgentPacks();

    const results = await sync(root, {
      config: config(['claude', 'cursor', 'copilot', 'codex']),
      silent: true,
    });

    expect(results.errors).toEqual([]);
    expect(has('.claude/agents/pr-reviewer.md')).toBe(true);
    expect(has('.cursor/agents/pr-reviewer.md')).toBe(false);
    expect(has('.github/agents/pr-reviewer.agent.md')).toBe(false);
    expect(has('.codex/agents/pr-reviewer.toml')).toBe(false);
    // A pack with `platforms: []` (what the catalog generator emits by default) goes everywhere.
    expect(has('.cursor/agents/docs-maintainer.md')).toBe(true);
    expect(has('.codex/agents/docs-maintainer.toml')).toBe(true);
  });

  it('writes nothing for a pack none of whose platforms is synced, and logs why', async () => {
    installAgentPacks();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let printed: string[];
    try {
      await sync(root, { config: config(['cursor']) });
      printed = log.mock.calls.map((c) => String(c[0]));
    } finally {
      log.mockRestore();
    }

    expect(has('.cursor/agents/pr-reviewer.md')).toBe(false);
    expect(has('.cursor/agents/docs-maintainer.md')).toBe(true);
    expect(printed).toContain('  1 limited by platform');
    expect(printed).toContain('    - pr-reviewer: claude only — skipped for cursor');
    expect(printed).toContain('  -> .cursor/agents/ (1 files)');
  });

  it('writes a skill to a shared skills dir when any platform reading it is allowed', async () => {
    const pack = installFakePack(root, 'bluetemberg-skills-devin-flow');
    writeSkill(pack, 'devin-flow');
    writeSkill(pack, 'claude-loop');
    writeCatalog(root, [
      catalogPack('bluetemberg-skills-devin-flow', 'skills', ['devin-flow', 'claude-loop'], ['devin']),
    ]);
    // Per-file frontmatter wins over the pack's list.
    writeSkill(pack, 'claude-loop', 'platforms: [claude]');

    await sync(root, { config: config(['codex', 'devin', 'claude']), silent: true });

    // `.agents/skills/` is read by Codex and Devin; the Devin-only skill belongs there.
    expect(has('.agents/skills/devin-flow/SKILL.md')).toBe(true);
    expect(has('.claude/skills/devin-flow/SKILL.md')).toBe(false);
    expect(has('.claude/skills/claude-loop/SKILL.md')).toBe(true);
    expect(has('.agents/skills/claude-loop/SKILL.md')).toBe(false);
  });

  it('routes the AGENTS.md rules block by its readers (Codex, Gemini)', async () => {
    writeMd(join(root, 'llm'), 'rules', 'codex-only', 'platforms: [codex]');
    writeMd(join(root, 'llm'), 'rules', 'claude-only', 'platforms: [claude]');
    writeMd(join(root, 'llm'), 'rules', 'everywhere');

    await sync(root, { config: config(['codex', 'cursor']), silent: true });

    const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('codex-only');
    expect(agentsMd).toContain('everywhere');
    expect(agentsMd).not.toContain('claude-only');
    expect(has('.cursor/rules/codex-only.mdc')).toBe(false);
    expect(has('.cursor/rules/everywhere.mdc')).toBe(true);
  });

  it('honors local frontmatter, the windsurf alias, and treats `platforms: []` as every platform', async () => {
    writeMd(join(root, 'llm'), 'rules', 'legacy-alias', 'platforms: [windsurf]');
    writeMd(installFakePack(root, 'bluetemberg-rules-claude'), 'rules', 'opened', 'platforms: []');
    writeCatalog(root, [catalogPack('bluetemberg-rules-claude', 'rules', ['opened'], ['claude'])]);

    await sync(root, { config: config(['devin', 'cursor']), silent: true });

    expect(has('.devin/rules/legacy-alias.md')).toBe(true);
    expect(has('.cursor/rules/legacy-alias.mdc')).toBe(false);
    // The file's explicit empty list overrides its pack's `claude` restriction.
    expect(has('.cursor/rules/opened.mdc')).toBe(true);
  });

  it('warns on an unknown platform id and on a malformed list instead of skipping silently', async () => {
    writeMd(join(root, 'llm'), 'rules', 'typo', 'platforms: [cursr]');
    writeMd(join(root, 'llm'), 'rules', 'scalar', 'platforms: cursor');

    const results = await sync(root, { config: config(['cursor']), silent: true });

    expect(results.warnings.some((w) => w.includes('rules/typo.md') && w.includes('cursr'))).toBe(true);
    expect(results.warnings.some((w) => w.includes('rules/scalar.md') && w.includes('ignored'))).toBe(true);
    // An unknown id matches nothing; a malformed list is ignored (falls back to every platform here).
    expect(has('.cursor/rules/typo.mdc')).toBe(false);
    expect(has('.cursor/rules/scalar.mdc')).toBe(true);
  });

  it('quietly ignores a catalog platform id this engine does not know (a newer packs repo)', async () => {
    writeMd(installFakePack(root, 'bluetemberg-agents-future'), 'agents', 'future');
    writeCatalog(root, [catalogPack('bluetemberg-agents-future', 'agents', ['future'], ['claude', 'zed'])]);

    const results = await sync(root, { config: config(['claude', 'cursor']), silent: true });

    expect(results.warnings).toEqual([]);
    expect(has('.claude/agents/future.md')).toBe(true);
    expect(has('.cursor/agents/future.md')).toBe(false);
  });

  it('reports and prunes an output once its pack is limited to other platforms', async () => {
    writeMd(installFakePack(root, 'bluetemberg-agents-pr-reviewer'), 'agents', 'pr-reviewer');
    writeCatalog(root, [catalogPack('bluetemberg-agents-pr-reviewer', 'agents', ['pr-reviewer'])]);
    await sync(root, { config: config(['claude', 'cursor']), silent: true });
    expect(has('.cursor/agents/pr-reviewer.md')).toBe(true);

    // The pack starts declaring `platforms: [claude]` (a catalog refresh after a pack release).
    writeCatalog(root, [
      catalogPack('bluetemberg-agents-pr-reviewer', 'agents', ['pr-reviewer'], ['claude']),
    ]);
    const check = await sync(root, { config: config(['claude', 'cursor']), check: true, silent: true });
    expect(check.stale).toBe(1);

    await sync(root, { config: config(['claude', 'cursor']), prune: true, silent: true });
    expect(has('.cursor/agents/pr-reviewer.md')).toBe(false);
    expect(has('.claude/agents/pr-reviewer.md')).toBe(true);
  });

  it('publishes Claude Code content to the marketplace and keeps other-platform content out', async () => {
    writeMd(join(root, 'llm'), 'agents', 'claude-agent', 'platforms: [claude]');
    writeMd(join(root, 'llm'), 'agents', 'cursor-agent', 'platforms: [cursor]');
    writeMd(join(root, 'llm'), 'agents', 'plugin-only', 'platforms: [claude-marketplace]');

    await sync(root, { config: config(['claude-marketplace']), silent: true });

    const plugin = join('plugins', root.split('/').pop() ?? '', 'agents');
    expect(has(join(plugin, 'claude-agent.md'))).toBe(true);
    expect(has(join(plugin, 'plugin-only.md'))).toBe(true);
    expect(has(join(plugin, 'cursor-agent.md'))).toBe(false);
  });

  it('applies a guardrail pack’s catalog platforms when the guardrail names none', async () => {
    const pack = installFakePack(root, 'bluetemberg-guardrails-cursor');
    mkdirSync(join(pack, 'guardrails'), { recursive: true });
    writeFileSync(
      join(pack, 'guardrails', 'shell-guard.md'),
      '---\ntrigger: Bash\nmessage: blocked\ncheck:\n  field: command\n  not_empty: true\n---\n',
    );
    writeCatalog(root, [
      catalogPack('bluetemberg-guardrails-cursor', 'guardrails', ['shell-guard'], ['cursor']),
    ]);

    await sync(root, { config: config(['claude', 'cursor']), silent: true });

    expect(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf8')).toContain('bluetemberg');
    expect(has('.claude/settings.json')).toBe(false);
  });

  it('routes each monorepo package by its own merged platforms', async () => {
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['claude'], source: 'llm', root: true }),
    );
    writeMd(join(root, 'llm'), 'rules', 'claude-only', 'platforms: [claude]');
    // `web` inherits the root's `claude` (platforms union up the chain) and adds `cursor`.
    const web = join(root, 'packages', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(
      join(web, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 'llm' }),
    );
    writeMd(join(web, 'llm'), 'rules', 'claude-only', 'platforms: [claude]');
    // `legacy` stops inheritance, so it targets Cursor alone.
    const legacy = join(root, 'packages', 'legacy');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(
      join(legacy, 'bluetemberg.config.json'),
      JSON.stringify({ platforms: ['cursor'], source: 'llm', root: true }),
    );
    writeMd(join(legacy, 'llm'), 'rules', 'claude-only', 'platforms: [claude]');
    writeMd(join(legacy, 'llm'), 'rules', 'shared');

    await sync(root, { silent: true });

    expect(has('.claude/rules/claude-only.md')).toBe(true);
    expect(existsSync(join(web, '.claude', 'rules', 'claude-only.md'))).toBe(true);
    expect(existsSync(join(web, '.cursor', 'rules', 'claude-only.mdc'))).toBe(false);
    expect(existsSync(join(legacy, '.claude'))).toBe(false);
    expect(existsSync(join(legacy, '.cursor', 'rules', 'claude-only.mdc'))).toBe(false);
    expect(existsSync(join(legacy, '.cursor', 'rules', 'shared.mdc'))).toBe(true);
  });

  it('does not report a platform as skipped when it reads a shared output that is written', async () => {
    writeSkill(join(root, 'llm'), 'devin-flow', 'platforms: [devin]');
    writeMd(join(root, 'llm'), 'rules', 'gemini-only', 'platforms: [gemini]');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let printed: string[];
    try {
      await sync(root, { config: config(['devin', 'codex', 'claude', 'gemini']) });
      printed = log.mock.calls.map((c) => String(c[0]));
    } finally {
      log.mockRestore();
    }

    // `.agents/skills/` is read by Codex too; the AGENTS.md block by Codex and Gemini.
    expect(printed).toContain('    - devin-flow: devin only — skipped for claude, gemini');
    expect(printed).toContain('    - gemini-only: gemini only — skipped for devin, claude');
  });

  it('applies a guardrail pack’s catalog platforms through the Copilot and Devin hosts', async () => {
    const pack = installFakePack(root, 'bluetemberg-guardrails-copilot');
    mkdirSync(join(pack, 'guardrails'), { recursive: true });
    writeFileSync(
      join(pack, 'guardrails', 'shell-guard.md'),
      '---\ntrigger: Bash\nmessage: blocked\ncheck:\n  field: command\n  not_empty: true\n---\n',
    );
    writeCatalog(root, [
      catalogPack('bluetemberg-guardrails-copilot', 'guardrails', ['shell-guard'], ['copilot']),
    ]);

    await sync(root, { config: config(['copilot', 'devin']), silent: true });

    expect(has('.github/hooks/bluetemberg-guardrails.json')).toBe(true);
    expect(has('.devin/hooks.v1.json')).toBe(false);
  });

  it('syncs byte-identically when nothing declares platforms', async () => {
    writeMd(join(root, 'llm'), 'rules', 'plain');
    const first = await sync(root, { config: config(['claude', 'cursor']), silent: true });
    expect(first.synced).toBe(2);
    const check = await sync(root, { config: config(['claude', 'cursor']), check: true, silent: true });
    expect(check.outOfSync).toBe(0);
  });
});
