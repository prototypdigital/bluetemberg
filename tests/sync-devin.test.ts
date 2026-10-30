import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync, loadConfig } from '../src/sync/index.js';
import { hasGeneratedBanner, withGeneratedBanner } from '../src/sync/banner.js';
import { normalizePlatforms } from '../src/sync/targets.js';
import { scaffold } from '../src/init/scaffold.js';
import { PLATFORM_CHOICES } from '../src/init/presets.js';
import { getMachineReadableHelp } from '../src/help-json.js';
import type { BlueprintConfig, InitAnswers } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-devin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSource(root: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'rules', 'testing.md'),
    '---\ndescription: Testing\nscope: "**/*.test.ts"\n---\n\n# Testing\n',
  );
  mkdirSync(join(root, 'llm', 'skills', 'review'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: Review\n---\n\n# Review\n',
  );
  mkdirSync(join(root, 'llm', 'commands'), { recursive: true });
  writeFileSync(join(root, 'llm', 'commands', 'ship.md'), '# Ship\n');
}

function writeGenerated(path: string, body: string, source: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, withGeneratedBanner(body, source));
}

/** Every file under `dir`, relative, sorted — a snapshot of what sync produced. */
function tree(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((ent) =>
      ent.isDirectory() ? tree(join(dir, ent.name), `${prefix}${ent.name}/`) : [`${prefix}${ent.name}`],
    )
    .sort();
}

const config = (platforms: BlueprintConfig['platforms'], targets: BlueprintConfig['targets'] = {}) =>
  ({ platforms, source: 'llm', targets }) satisfies BlueprintConfig;

describe('Devin Desktop target', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeSource(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes rules to .devin/rules/ with a .windsurf/rules/ mirror, and skills to .agents/skills/', async () => {
    const results = await sync(root, { config: config(['devin']), silent: true });

    expect(results.errors).toEqual([]);
    const rule = readFileSync(join(root, '.devin', 'rules', 'testing.md'), 'utf8');
    expect(rule).toContain('trigger: glob');
    expect(rule).toContain("globs: '**/*.test.ts'");
    expect(readFileSync(join(root, '.windsurf', 'rules', 'testing.md'), 'utf8')).toBe(rule);
    expect(
      hasGeneratedBanner(readFileSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')),
    ).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'skills'))).toBe(false);
    expect(existsSync(join(root, '.windsurf', 'workflows'))).toBe(false);
  });

  it('treats the windsurf alias exactly like devin', async () => {
    const other = createTmpDir();
    writeSource(other);
    try {
      await sync(root, { config: config(['devin']), silent: true });
      await sync(other, { config: config(['windsurf']), silent: true });
      expect(tree(other)).toEqual(tree(root));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('migrates targets that init wrote for windsurf before the rename', async () => {
    const legacy = config(['windsurf'], {
      rules: { windsurf: { dir: '.windsurf/rules', ext: '.md' } },
      skills: { windsurf: { dir: '.windsurf/skills' } },
    });

    await sync(root, { config: legacy, silent: true });

    expect(existsSync(join(root, '.devin', 'rules', 'testing.md'))).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'rules', 'testing.md'))).toBe(true);
    expect(existsSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'skills'))).toBe(false);
  });

  it('keeps a custom windsurf target dir as the Devin target', async () => {
    await sync(root, {
      config: config(['windsurf'], { rules: { windsurf: { dir: 'ai/rules', ext: '.md' } } }),
      silent: true,
    });

    expect(existsSync(join(root, 'ai', 'rules', 'testing.md'))).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'rules', 'testing.md'))).toBe(true);
  });

  it('writes the .agents/skills/ dir Codex shares once, with no prune conflict', async () => {
    const both = config(['devin', 'codex']);
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(' '));
    try {
      const results = await sync(root, { config: both });
      expect(results.errors).toEqual([]);
    } finally {
      console.log = orig;
    }
    // Once for llm/skills/, once for llm/commands/ship.md migrated to a skill.
    expect(logs.filter((line) => line.includes('-> .agents/skills/'))).toEqual([
      '  -> .agents/skills/ (1 skills)',
      '  -> .agents/skills/ (1 skills)',
    ]);
    expect(existsSync(join(root, '.agents', 'skills', 'ship', 'SKILL.md'))).toBe(true);

    const pruned = await sync(root, { config: both, prune: true, silent: true });
    expect(pruned.errors).toEqual([]);
    expect(existsSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'))).toBe(true);

    const check = await sync(root, { config: both, check: true, silent: true });
    expect(check.outOfSync).toBe(0);
  });

  it('migrates a legacy default dir written with ./ or a trailing slash', async () => {
    await sync(root, {
      config: config(['windsurf'], {
        rules: { windsurf: { dir: './.windsurf/rules/', ext: '.md' } },
        skills: { windsurf: { dir: '.windsurf/skills/' } },
      }),
      silent: true,
    });

    expect(existsSync(join(root, '.devin', 'rules', 'testing.md'))).toBe(true);
    expect(existsSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'skills'))).toBe(false);
  });

  it('prunes from a relative root when the Devin skill target is .windsurf/skills', async () => {
    const custom = config(['devin'], { skills: { devin: { dir: '.windsurf/skills' } } });
    const cwd = process.cwd();
    process.chdir(join(root, '..'));
    try {
      const rel = basename(root);
      await sync(rel, { config: custom, silent: true });
      writeGenerated(
        join(root, '.windsurf', 'skills', 'gone', 'SKILL.md'),
        '# Gone\n',
        'skills/gone/SKILL.md',
      );

      const results = await sync(rel, { config: custom, prune: true, silent: true });

      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, '.windsurf', 'skills', 'gone'))).toBe(false);
      expect(existsSync(join(root, '.windsurf', 'skills', 'review', 'SKILL.md'))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('prunes a stale rule once when the legacy mirror overlaps another rule target', async () => {
    const overlap = config(['devin', 'gemini'], {
      rules: {
        devin: { dir: '.devin/rules', ext: '.md' },
        gemini: { dir: '.windsurf/rules', ext: '.md' },
      },
    });
    await sync(root, { config: overlap, silent: true });
    writeGenerated(join(root, '.windsurf', 'rules', 'old.md'), '# Old\n', 'rules/old.md');

    const results = await sync(root, { config: overlap, prune: true, silent: true });

    expect(results.errors).toEqual([]);
    expect(existsSync(join(root, '.windsurf', 'rules', 'old.md'))).toBe(false);
    expect(existsSync(join(root, '.windsurf', 'rules', 'testing.md'))).toBe(true);
    // The mirror steps aside for gemini's target, so the two never fight over the same file.
    const check = await sync(root, { config: overlap, check: true, silent: true });
    expect(check.outOfSync).toBe(0);
  });

  it("keeps a child package's windsurf override over its parent's devin target", async () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['devin'],
        targets: { rules: { devin: { dir: 'parent/rules', ext: '.md' } } },
      }),
    );
    const pkg = join(root, 'packages', 'app');
    writeSource(pkg);
    writeFileSync(
      join(pkg, 'bluetemberg.config.json'),
      JSON.stringify({ source: 'llm', targets: { rules: { windsurf: { dir: 'child/rules', ext: '.md' } } } }),
    );

    expect(loadConfig(pkg).targets?.rules?.devin).toEqual({ dir: 'child/rules', ext: '.md' });
    await sync(pkg, { recursive: false, silent: true });
    expect(existsSync(join(pkg, 'child', 'rules', 'testing.md'))).toBe(true);
    expect(existsSync(join(pkg, 'parent', 'rules'))).toBe(false);
  });

  describe('retired Windsurf outputs', () => {
    beforeEach(() => {
      writeGenerated(join(root, '.windsurf', 'workflows', 'ship.md'), '# Ship\n', 'commands/ship.md');
      writeGenerated(
        join(root, '.windsurf', 'skills', 'review', 'SKILL.md'),
        '# Review\n',
        'skills/review/SKILL.md',
      );
      writeFileSync(join(root, '.windsurf', 'skills', 'review', 'notes.txt'), 'supporting\n');
    });

    it('sync --check reports them as stale', async () => {
      await sync(root, { config: config(['windsurf']), silent: true });
      const results = await sync(root, { config: config(['windsurf']), check: true, silent: true });

      expect(results.stale).toBe(3);
      expect(results.outOfSync).toBe(3);
    });

    it('sync --prune removes them and leaves .windsurf/rules/ in place', async () => {
      const results = await sync(root, { config: config(['devin']), prune: true, silent: true });

      expect(results.errors).toEqual([]);
      expect(existsSync(join(root, '.windsurf', 'workflows'))).toBe(false);
      expect(existsSync(join(root, '.windsurf', 'skills'))).toBe(false);
      expect(existsSync(join(root, '.windsurf', 'rules', 'testing.md'))).toBe(true);

      const check = await sync(root, { config: config(['devin']), check: true, silent: true });
      expect(check.outOfSync).toBe(0);
    });

    it('sync --prune keeps hand-written workflows', async () => {
      writeFileSync(join(root, '.windsurf', 'workflows', 'mine.md'), '# Mine\n');

      await sync(root, { config: config(['devin']), prune: true, silent: true });

      expect(existsSync(join(root, '.windsurf', 'workflows', 'mine.md'))).toBe(true);
      expect(existsSync(join(root, '.windsurf', 'workflows', 'ship.md'))).toBe(false);
    });
  });
});

describe('devin platform id', () => {
  it('normalizes the windsurf alias and dedupes', () => {
    expect(normalizePlatforms(['windsurf', 'claude', 'devin'])).toEqual(['devin', 'claude']);
  });

  it('accepts both ids in a config file', () => {
    const root = createTmpDir();
    try {
      for (const id of ['devin', 'windsurf']) {
        writeFileSync(
          join(root, 'bluetemberg.config.json'),
          JSON.stringify({
            platforms: [id],
            targets: { rules: { [id]: { dir: '.devin/rules', ext: '.md' } } },
          }),
        );
        expect(loadConfig(root).platforms).toEqual([id]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('shows Devin Desktop in the wizard and --help --json', () => {
    expect(PLATFORM_CHOICES).toContainEqual({ id: 'devin', name: 'Devin Desktop (formerly Windsurf)' });
    expect(PLATFORM_CHOICES.some((p) => p.id === 'windsurf')).toBe(false);
    const help = getMachineReadableHelp() as { platforms: { id: string }[]; platformAliases: object };
    expect(help.platforms.map((p) => p.id)).toContain('devin');
    expect(help.platformAliases).toEqual({ windsurf: 'devin' });
  });

  it('init writes devin when given the windsurf alias', () => {
    const root = createTmpDir();
    try {
      const answers: InitAnswers = {
        teamProfile: 'custom',
        projectName: 'demo',
        projectDescription: '',
        packageManager: 'npm',
        platforms: ['windsurf', 'codex'],
        ruleSource: 'none',
        rules: [],
        ruleCollections: [],
        includeAgents: false,
        agents: [],
        includeSkills: false,
        skills: [],
        includeMcp: false,
        mcpServers: [],
      };
      scaffold(root, answers);

      const written = JSON.parse(
        readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'),
      ) as BlueprintConfig;
      expect(written.platforms).toEqual(['devin', 'codex']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
