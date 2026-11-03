import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync, loadConfig } from '../src/sync/index.js';
import { normalizeExtends } from '../src/sync/extends-loader.js';
import { buildWhyReport } from '../src/stacks/why.js';
import type { BlueprintConfig } from '../src/types.js';

/**
 * Platform-scoped `extends` entries (#207): `{ "path", "platforms" }` entries apply only when
 * syncing those platforms; plain strings keep applying to every platform.
 */

function writeRule(dir: string, name: string, body = name): void {
  mkdirSync(join(dir, 'rules'), { recursive: true });
  writeFileSync(
    join(dir, 'rules', `${name}.md`),
    `---\ndescription: ${name}\nscope: "**"\n---\n\n# ${body}\n`,
  );
}

function writeSkill(dir: string, name: string): void {
  mkdirSync(join(dir, 'skills', name), { recursive: true });
  writeFileSync(
    join(dir, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}\n`,
  );
}

const NO_FORCE_PUSH = `---
description: No force push
trigger: Bash
check:
  field: command
  not_matches: 'git push.*--force'
message: 'Force-push is blocked.'
---

# No force push
`;

function writeConfig(dir: string, config: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bluetemberg.config.json'), JSON.stringify(config, null, 2));
}

const CLAUDE_CURSOR: Pick<BlueprintConfig, 'platforms' | 'source' | 'targets'> = {
  platforms: ['claude', 'cursor'],
  source: 'llm',
  targets: {
    rules: {
      claude: { dir: '.claude/rules', ext: '.md' },
      cursor: { dir: '.cursor/rules', ext: '.mdc' },
    },
    skills: { claude: { dir: '.claude/skills' }, cursor: { dir: '.cursor/skills' } },
  },
};

describe('extends: platform-scoped entries', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-extends-platforms-'));
    mkdirSync(join(root, 'llm'), { recursive: true });
    // An enclosing `.git` keeps config discovery from walking above the fixture.
    mkdirSync(join(root, '.git'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  describe('config validation', () => {
    const load = (ext: unknown): BlueprintConfig => {
      writeConfig(root, { platforms: ['claude'], source: 'llm', targets: {}, extends: ext });
      return loadConfig(root);
    };

    it('accepts a mix of strings and scoped entries', () => {
      const ext = ['./a', { path: './b', platforms: ['claude', 'cursor'] }];
      expect(load(ext).extends).toEqual(ext);
    });

    it('keeps rejecting a non-string, non-array value', () => {
      expect(() => load(42)).toThrow('"extends" must be a string or array of strings');
    });

    it('rejects a single top-level object (entries go in an array)', () => {
      expect(() => load({ path: './a', platforms: ['claude'] })).toThrow(
        /"extends" must be a string or array/,
      );
    });

    it.each([
      [[42], /extends\[0\] must be a string or \{ "path": string, "platforms": string\[\] \}/],
      [['./a', { platforms: ['claude'] }], /extends\[1\]\.path must be a non-empty string/],
      [[{ path: '', platforms: ['claude'] }], /extends\[0\]\.path must be a non-empty string/],
      [[{ path: './a' }], /extends\[0\]\.platforms must be a non-empty array of platform ids/],
      [[{ path: './a', platforms: [] }], /extends\[0\]\.platforms must be a non-empty array/],
      [[{ path: './a', platforms: 'claude' }], /extends\[0\]\.platforms must be a non-empty array/],
      [
        [{ path: './a', platforms: ['claude', 'vscode'] }],
        /extends\[0\]\.platforms has unknown platform\(s\): vscode/,
      ],
      [[{ path: './a', platform: ['claude'] }], /extends\[0\] has unknown key\(s\) platform/],
    ])('rejects a bad entry: %j', (ext, message) => {
      expect(() => load(ext)).toThrow(message);
    });

    it('accepts the windsurf alias in a scope', () => {
      expect(() => load([{ path: './a', platforms: ['windsurf'] }])).not.toThrow();
    });
  });

  describe('normalizeExtends', () => {
    it('unions the scopes of a duplicated path and keeps its first position', () => {
      expect(
        normalizeExtends([
          { path: './a', platforms: ['claude'] },
          './b',
          { path: './a', platforms: ['cursor', 'claude'] },
        ]),
      ).toEqual([
        { path: './a', platforms: ['claude', 'cursor'] },
        { path: './b', platforms: null },
      ]);
    });

    it('lets an unscoped duplicate widen a scoped entry to every platform', () => {
      expect(normalizeExtends([{ path: './a', platforms: ['claude'] }, './a'])).toEqual([
        { path: './a', platforms: null },
      ]);
    });

    it('reads windsurf as devin', () => {
      expect(normalizeExtends([{ path: './a', platforms: ['windsurf', 'devin'] }])).toEqual([
        { path: './a', platforms: ['devin'] },
      ]);
    });
  });

  describe('monorepo config inheritance', () => {
    it('merges scoped entries across the chain, child first, unioning duplicate scopes', () => {
      writeConfig(root, {
        root: true,
        platforms: ['claude', 'cursor'],
        targets: {},
        extends: ['../shared', { path: '../claude-only', platforms: ['claude'] }],
      });
      const pkg = join(root, 'packages', 'web');
      writeConfig(pkg, {
        source: 'llm',
        targets: {},
        extends: [
          { path: '../claude-only', platforms: ['cursor'] },
          { path: './local', platforms: ['cursor'] },
        ],
      });

      expect(loadConfig(pkg).extends).toEqual([
        { path: '../claude-only', platforms: ['cursor', 'claude'] },
        { path: './local', platforms: ['cursor'] },
        '../shared',
      ]);
    });
  });

  describe('sync', () => {
    it('writes a scoped entry only for its platforms', async () => {
      writeRule(join(root, 'everyone', 'llm'), 'shared-rule');
      writeRule(join(root, 'claude-only', 'llm'), 'claude-rule');

      const results = await sync(root, {
        config: {
          ...CLAUDE_CURSOR,
          extends: ['./everyone', { path: './claude-only', platforms: ['claude'] }],
        },
        silent: true,
      });

      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, '.claude/rules/shared-rule.md'))).toBe(true);
      expect(existsSync(join(root, '.claude/rules/claude-rule.md'))).toBe(true);
      expect(existsSync(join(root, '.cursor/rules/shared-rule.mdc'))).toBe(true);
      expect(existsSync(join(root, '.cursor/rules/claude-rule.mdc'))).toBe(false);
    });

    it('lets other platforms fall through to a lower-priority copy a scoped entry shadows', async () => {
      writeRule(join(root, 'claude-only', 'llm'), 'testing', 'Claude copy');
      writeRule(join(root, 'everyone', 'llm'), 'testing', 'Shared copy');

      const results = await sync(root, {
        config: {
          ...CLAUDE_CURSOR,
          extends: [{ path: './claude-only', platforms: ['claude'] }, './everyone'],
        },
        silent: true,
      });

      expect(results.errors).toEqual([]);
      expect(readFileSync(join(root, '.claude/rules/testing.md'), 'utf8')).toContain('Claude copy');
      expect(readFileSync(join(root, '.cursor/rules/testing.mdc'), 'utf8')).toContain('Shared copy');
    });

    it('syncs a scope covering every configured platform exactly like a plain string', async () => {
      writeRule(join(root, 'shared', 'llm'), 'r');
      writeSkill(join(root, 'shared', 'llm'), 's');

      const plain = await sync(root, { config: { ...CLAUDE_CURSOR, extends: ['./shared'] }, silent: true });
      const before = readFileSync(join(root, '.cursor/rules/r.mdc'), 'utf8');
      const scoped = await sync(root, {
        config: { ...CLAUDE_CURSOR, extends: [{ path: './shared', platforms: ['cursor', 'claude'] }] },
        check: true,
        silent: true,
      });

      expect(plain.errors).toEqual([]);
      expect(scoped.outOfSync).toBe(0);
      expect(readFileSync(join(root, '.cursor/rules/r.mdc'), 'utf8')).toBe(before);
    });

    it('warns about, and never syncs, an entry scoped only to unconfigured platforms', async () => {
      writeRule(join(root, 'gemini-only', 'llm'), 'gemini-rule');

      const results = await sync(root, {
        config: { ...CLAUDE_CURSOR, extends: [{ path: './gemini-only', platforms: ['gemini'] }] },
        silent: true,
      });

      expect(results.errors).toEqual([]);
      expect(results.warnings).toContain(
        'extends entry "./gemini-only" is scoped to gemini, none of which is in "platforms", so it is never synced',
      );
      expect(existsSync(join(root, '.claude/rules/gemini-rule.md'))).toBe(false);
      expect(existsSync(join(root, '.cursor/rules/gemini-rule.mdc'))).toBe(false);
    });

    it('does not warn when a scope names some configured platforms', async () => {
      writeRule(join(root, 'shared', 'llm'), 'r');
      const results = await sync(root, {
        config: { ...CLAUDE_CURSOR, extends: [{ path: './shared', platforms: ['claude', 'gemini'] }] },
        silent: true,
      });
      expect(results.warnings).toEqual([]);
      expect(existsSync(join(root, '.claude/rules/r.md'))).toBe(true);
    });

    it('is in sync in --check right after a scoped write', async () => {
      writeRule(join(root, 'everyone', 'llm'), 'shared-rule');
      writeRule(join(root, 'claude-only', 'llm'), 'claude-rule');
      writeSkill(join(root, 'claude-only', 'llm'), 'claude-skill');
      const config: BlueprintConfig = {
        ...CLAUDE_CURSOR,
        extends: ['./everyone', { path: './claude-only', platforms: ['claude'] }],
      };

      await sync(root, { config, silent: true });
      const check = await sync(root, { config, check: true, silent: true });

      expect(check.outOfSync).toBe(0);
      expect(check.stale).toBe(0);
    });

    it('reports and prunes outputs of a platform an entry no longer applies to', async () => {
      writeRule(join(root, 'shared', 'llm'), 'r');
      await sync(root, { config: { ...CLAUDE_CURSOR, extends: ['./shared'] }, silent: true });
      expect(existsSync(join(root, '.cursor/rules/r.mdc'))).toBe(true);

      const narrowed: BlueprintConfig = {
        ...CLAUDE_CURSOR,
        extends: [{ path: './shared', platforms: ['claude'] }],
      };
      const check = await sync(root, { config: narrowed, check: true, silent: true });
      expect(check.stale).toBe(1);

      await sync(root, { config: narrowed, prune: true, silent: true });
      expect(existsSync(join(root, '.cursor/rules/r.mdc'))).toBe(false);
      expect(existsSync(join(root, '.claude/rules/r.md'))).toBe(true);
    });

    it('records a repeated message once, not once per source view', async () => {
      writeRule(join(root, 'a', 'llm'), 'dup');
      writeRule(join(root, 'b', 'llm'), 'dup');

      const results = await sync(root, {
        config: { ...CLAUDE_CURSOR, extends: ['./a', './b', { path: './c', platforms: ['claude'] }] },
        silent: true,
      });

      const shadowed = results.warnings.filter((w) => w.startsWith('rules/dup.md is shipped by'));
      expect(shadowed).toHaveLength(1);
    });

    it('refuses to split platforms that share an output dir', async () => {
      writeSkill(join(root, 'codex-only', 'llm'), 'codex-skill');

      const results = await sync(root, {
        config: {
          platforms: ['codex', 'devin'],
          source: 'llm',
          targets: {},
          extends: [{ path: './codex-only', platforms: ['codex'] }],
        },
        silent: true,
      });

      expect(results.errors).toEqual([
        'scoped "extends" entries give codex, devin different sources, but they all write .agents/skills/ — scope those entries to all of codex, devin or none of them',
      ]);
      expect(results.synced).toBe(0);
      expect(existsSync(join(root, '.agents/skills/codex-skill/SKILL.md'))).toBe(false);
    });

    it('refuses to split codex and gemini, which share the AGENTS.md rules block', async () => {
      writeRule(join(root, 'codex-only', 'llm'), 'r');
      writeFileSync(join(root, 'AGENTS.md'), '# Project\n');

      const results = await sync(root, {
        config: {
          platforms: ['codex', 'gemini'],
          source: 'llm',
          targets: {},
          extends: [{ path: './codex-only', platforms: ['codex'] }],
        },
        silent: true,
      });

      expect(results.errors.some((e) => e.includes('they all write AGENTS.md'))).toBe(true);
    });

    it('allows a split when the sharing platforms are scoped alike', async () => {
      writeSkill(join(root, 'agents-only', 'llm'), 'k');

      const results = await sync(root, {
        config: {
          platforms: ['codex', 'devin', 'claude'],
          source: 'llm',
          targets: {},
          extends: [{ path: './agents-only', platforms: ['codex', 'devin', 'antigravity'] }],
        },
        silent: true,
      });

      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, '.agents/skills/k/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, '.claude/skills/k/SKILL.md'))).toBe(false);
    });

    it('compiles guardrails from a scoped entry only for its platforms', async () => {
      mkdirSync(join(root, 'claude-only', 'llm', 'guardrails'), { recursive: true });
      writeFileSync(join(root, 'claude-only', 'llm', 'guardrails', 'no-force-push.md'), NO_FORCE_PUSH);

      const results = await sync(root, {
        config: { ...CLAUDE_CURSOR, extends: [{ path: './claude-only', platforms: ['claude'] }] },
        silent: true,
      });

      expect(results.errors).toEqual([]);
      const settings = readFileSync(join(root, '.claude/settings.json'), 'utf8');
      expect(settings).toContain('Force-push is blocked.');
      expect(existsSync(join(root, '.cursor/hooks.json'))).toBe(false);
    });

    it('feeds claude-marketplace every pack while claude gets only its own', async () => {
      // The bluetemberg-packs dogfooding shape: every pack is published, few are used natively.
      writeSkill(join(root, 'packages', 'create-pack', 'llm'), 'create-pack');
      writeSkill(join(root, 'packages', 'k8s', 'llm'), 'kubernetes');

      const results = await sync(root, {
        config: {
          platforms: ['claude', 'claude-marketplace'],
          source: 'llm',
          targets: { skills: { claude: { dir: '.claude/skills' } } },
          extends: ['./packages/create-pack', { path: './packages/k8s', platforms: ['claude-marketplace'] }],
        },
        silent: true,
      });

      const plugin = `plugins/${basename(root)}`;
      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, '.claude/skills/create-pack/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, '.claude/skills/kubernetes/SKILL.md'))).toBe(false);
      expect(existsSync(join(root, plugin, 'skills/create-pack/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, plugin, 'skills/kubernetes/SKILL.md'))).toBe(true);
    });

    it('applies scopes per package in a recursive monorepo sync', async () => {
      writeConfig(root, { root: true, platforms: ['claude', 'cursor'], targets: CLAUDE_CURSOR.targets });
      const pkg = join(root, 'packages', 'web');
      writeRule(join(root, 'packages', 'claude-only', 'llm'), 'claude-rule');
      writeConfig(pkg, {
        source: 'llm',
        targets: {},
        extends: [{ path: '../claude-only', platforms: ['claude'] }],
      });
      mkdirSync(join(pkg, 'llm'), { recursive: true });

      const results = await sync(root, { silent: true });

      expect(results.errors).toEqual([]);
      expect(existsSync(join(pkg, '.claude/rules/claude-rule.md'))).toBe(true);
      expect(existsSync(join(pkg, '.cursor/rules/claude-rule.mdc'))).toBe(false);
    });
  });

  describe('why', () => {
    it('lists only the outputs of the platforms an entry applies to', () => {
      writeRule(join(root, 'claude-only', 'llm'), 'claude-rule');
      writeConfig(root, { ...CLAUDE_CURSOR, extends: [{ path: './claude-only', platforms: ['claude'] }] });

      const [item] = buildWhyReport(root, 'claude-rule').matches;

      expect(item.source.label).toBe('extends ./claude-only (claude only)');
      expect(item.outputs).toEqual(['.claude/rules/claude-rule.md']);
      expect(item.byPlatform).toEqual([
        {
          platforms: ['claude'],
          source: 'extends ./claude-only (claude only)',
          included: true,
          reason: expect.any(String),
        },
        {
          platforms: ['cursor'],
          source: null,
          included: false,
          reason: 'no source for these platforms ships it',
        },
      ]);
    });

    it('does not match a generated path of a platform the entry skips', () => {
      writeRule(join(root, 'claude-only', 'llm'), 'claude-rule');
      writeConfig(root, { ...CLAUDE_CURSOR, extends: [{ path: './claude-only', platforms: ['claude'] }] });

      expect(buildWhyReport(root, '.cursor/rules/claude-rule.mdc').matchedAs).not.toBe('output');
      expect(buildWhyReport(root, '.claude/rules/claude-rule.md').matchedAs).toBe('output');
    });

    it('reports byPlatform as null without scoped entries', () => {
      writeRule(join(root, 'shared', 'llm'), 'r');
      writeConfig(root, { ...CLAUDE_CURSOR, extends: ['./shared'] });

      expect(buildWhyReport(root, 'r').matches[0].byPlatform).toBeNull();
    });
  });
});
