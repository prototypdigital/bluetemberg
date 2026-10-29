import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    const results = await sync(root, { config: both, silent: true });
    expect(results.errors).toEqual([]);
    expect(results.synced).toBe(
      (await sync(root, { config: config(['devin']), silent: true })).synced +
        (await sync(root, { config: config(['codex']), silent: true })).synced -
        1, // the shared SKILL.md
    );

    const pruned = await sync(root, { config: both, prune: true, silent: true });
    expect(pruned.errors).toEqual([]);
    expect(existsSync(join(root, '.agents', 'skills', 'review', 'SKILL.md'))).toBe(true);

    const check = await sync(root, { config: both, check: true, silent: true });
    expect(check.outOfSync).toBe(0);
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
    const help = getMachineReadableHelp() as { platforms: { id: string }[] };
    expect(help.platforms.map((p) => p.id)).toContain('devin');
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
