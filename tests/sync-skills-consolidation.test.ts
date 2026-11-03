import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { sync } from '../src/sync/index.js';
import { stripGeneratedBanner, withGeneratedBanner } from '../src/sync/banner.js';
import { resolveSkillOutputs, resolveSkillTargets } from '../src/sync/targets.js';
import { SKILL_METADATA_KEYS, stampSkillMetadata } from '../src/sync/skill-metadata.js';
import { claudeAgentNameProblem } from '../src/sync/claude-agent-tools.js';
import { withGeneratedBanner as banner } from '../src/sync/banner.js';
import { uninstall } from '../src/uninstall/index.js';
import { packVersionDir } from '../src/registry/installer.js';
import { writeLockfile, writeManifest } from '../src/registry/manifest.js';
import type { BlueprintConfig, Platform } from '../src/types.js';

const PACK = { name: 'bluetemberg-skills-demo', version: '1.2.3', integrity: 'sha512-demo==' };

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function config(platforms: Platform[], targets: BlueprintConfig['targets'] = {}): BlueprintConfig {
  return { platforms, source: 'llm', targets };
}

function dirs(platforms: Platform[], targets: BlueprintConfig['targets'] = {}) {
  return resolveSkillOutputs(config(platforms, targets), platforms).map(({ target, platforms: p }) => [
    target.dir,
    p,
  ]);
}

/** A locked, cached pack that ships one skill, the way `bluetemberg install` leaves it. */
function installPack(root: string, skill: string): void {
  writeManifest(root, { packages: { [PACK.name]: `^${PACK.version}` } });
  writeLockfile(root, {
    lockfileVersion: 1,
    packages: {
      [PACK.name]: {
        version: PACK.version,
        resolved: 'https://example.test/x.tgz',
        integrity: PACK.integrity,
      },
    },
  });
  const dir = packVersionDir(root, PACK.name, PACK.version);
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), skill);
}

describe('skill target resolution', () => {
  it('writes .claude/skills and .github/skills for the default platforms, leaving Cursor to Claude', () => {
    expect(dirs(['cursor', 'claude', 'copilot'])).toEqual([
      ['.claude/skills', ['claude', 'cursor']],
      ['.github/skills', ['copilot']],
    ]);
  });

  it('gives Cursor .agents/skills when Claude is not enabled', () => {
    expect(dirs(['cursor'])).toEqual([['.agents/skills', ['cursor']]]);
  });

  it('writes .agents/skills once for every vendor-neutral reader', () => {
    expect(dirs(['claude', 'cursor', 'codex', 'devin', 'antigravity', 'gemini'])).toEqual([
      ['.agents/skills', ['cursor', 'devin', 'codex', 'antigravity', 'gemini']],
      ['.claude/skills', ['claude']],
    ]);
  });

  it('treats the old .cursor/skills entry init wrote as the default, in any spelling', () => {
    for (const dir of ['.cursor/skills', './.cursor/skills/', '.cursor//skills']) {
      expect(
        dirs(['cursor', 'claude'], { skills: { cursor: { dir }, claude: { dir: '.claude/skills' } } }),
      ).toEqual([['.claude/skills', ['claude', 'cursor']]]);
    }
  });

  it('always writes a dir the user chose', () => {
    const targets = { skills: { cursor: { dir: '.my/skills' }, claude: { dir: '.claude/skills' } } };
    expect(dirs(['cursor', 'claude'], targets)).toEqual([
      ['.my/skills', ['cursor']],
      ['.claude/skills', ['claude']],
    ]);
  });

  it('names the first reader of each dir for the pair form', () => {
    expect(resolveSkillTargets(config(['cursor', 'claude']), ['cursor', 'claude'])).toEqual([
      ['claude', { dir: '.claude/skills' }],
    ]);
  });
});

describe('stampSkillMetadata', () => {
  it('appends a metadata block and keeps the author frontmatter byte for byte', () => {
    const source = "---\nname: demo\ndescription: 'Quoted, kept as is'\n---\n\nBody\n";
    const stamped = stampSkillMetadata(source, PACK);
    expect(stamped.startsWith("---\nname: demo\ndescription: 'Quoted, kept as is'\nmetadata:\n")).toBe(true);
    expect(stamped.endsWith('---\n\nBody\n')).toBe(true);
    expect(matter(stamped).data.metadata).toEqual({
      [SKILL_METADATA_KEYS.pack]: PACK.name,
      [SKILL_METADATA_KEYS.version]: PACK.version,
      [SKILL_METADATA_KEYS.integrity]: PACK.integrity,
    });
  });

  it('merges into an existing metadata map without repeating the key', () => {
    const stamped = stampSkillMetadata('---\nname: demo\nmetadata:\n  author: me\n---\nBody\n', PACK);
    const data = matter(stamped).data;
    expect(data.metadata).toMatchObject({ author: 'me', [SKILL_METADATA_KEYS.pack]: PACK.name });
    expect(stamped.match(/^metadata:/gm)).toHaveLength(1);
  });

  it('merges into an empty metadata key', () => {
    const stamped = stampSkillMetadata('---\nname: demo\nmetadata:\n---\nBody\n', PACK);
    expect(matter(stamped).data.metadata).toMatchObject({ [SKILL_METADATA_KEYS.version]: PACK.version });
  });

  it('keeps CRLF line endings', () => {
    const stamped = stampSkillMetadata('---\r\nname: demo\r\n---\r\nBody\r\n', PACK);
    expect(stamped).not.toMatch(/[^\r]\n/);
    expect(matter(stamped).data.metadata).toMatchObject({ [SKILL_METADATA_KEYS.pack]: PACK.name });
  });

  it('rejects a metadata value that is not a map, and leaves a skill without frontmatter alone', () => {
    expect(() => stampSkillMetadata('---\nname: demo\nmetadata: oops\n---\n', PACK)).toThrow(
      /map of strings/,
    );
    expect(stampSkillMetadata('# No frontmatter\n', PACK)).toBe('# No frontmatter\n');
  });

  it('stamps flow-map frontmatter through the merge path, keeping it valid YAML', () => {
    const stamped = stampSkillMetadata('---\n{name: demo, description: d}\n---\nBody\n', PACK);
    const data = matter(stamped).data;
    expect(data.name).toBe('demo');
    expect(data.metadata).toMatchObject({ [SKILL_METADATA_KEYS.pack]: PACK.name });
  });

  it('keeps a UTF-8 BOM first and still stamps the frontmatter after it', () => {
    const stamped = stampSkillMetadata('\uFEFF---\nname: demo\n---\nBody\n', PACK);
    expect(stamped.startsWith('\uFEFF---\nname: demo\nmetadata:')).toBe(true);
    const bannered = banner(stamped, 'skills/demo/SKILL.md');
    expect(bannered.startsWith('\uFEFF---\n')).toBe(true);
  });

  it('is stable: stamping the same source twice gives the same bytes', () => {
    const source = '---\nname: demo\n---\nBody\n';
    expect(stampSkillMetadata(source, PACK)).toBe(stampSkillMetadata(source, PACK));
  });
});

describe('claudeAgentNameProblem', () => {
  it('flags the names Claude Code skips', () => {
    expect(claudeAgentNameProblem('---\nname: plugin:agent\n---\n', 'x.md')).toMatch(/":"/);
    expect(claudeAgentNameProblem('---\nname: "-dash"\n---\n', 'x.md')).toMatch(/starts with "-"/);
    expect(claudeAgentNameProblem('# no frontmatter\n', 'a:b.md')).toMatch(/":"/);
    expect(claudeAgentNameProblem(`---\nname: ${'a'.repeat(257)}\n---\n`, 'x.md')).toMatch(/256/);
    expect(claudeAgentNameProblem('---\nname: reviewer\ndescription: "a: b"\n---\n', 'x.md')).toBeNull();
    expect(claudeAgentNameProblem('---\nname: reviewer # see: docs\n---\n', 'x.md')).toBeNull();
    expect(claudeAgentNameProblem("---\nname: 'ns:agent' # quoted\n---\n", 'x.md')).toMatch(/":"/);
  });
});

describe('sync', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-skills-consolidation-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stamps a pack skill with its pack, and --check stays in sync (no stamp loop)', async () => {
    installPack(root, '---\nname: demo\ndescription: Demo\n---\n\nDo the demo.\n');
    write(root, 'llm/skills/local/SKILL.md', '---\nname: local\ndescription: Local\n---\nLocal\n');
    const cfg = config(['claude', 'codex']);

    const first = await sync(root, { config: cfg, silent: true });
    expect(first.errors).toEqual([]);
    for (const dir of ['.claude/skills', '.agents/skills']) {
      const data = matter(stripGeneratedBanner(read(root, `${dir}/demo/SKILL.md`))).data;
      expect(data.metadata).toEqual({
        [SKILL_METADATA_KEYS.pack]: PACK.name,
        [SKILL_METADATA_KEYS.version]: PACK.version,
        [SKILL_METADATA_KEYS.integrity]: PACK.integrity,
      });
      // Local skills have no pack, so no stamp.
      expect(matter(stripGeneratedBanner(read(root, `${dir}/local/SKILL.md`))).data.metadata).toBeUndefined();
    }

    for (let i = 0; i < 2; i++) {
      const check = await sync(root, { config: cfg, check: true, silent: true });
      expect(check.outOfSync).toBe(0);
    }
  });

  it('upgrade from per-tool copies: --prune removes generated copies only, with a migration note', async () => {
    write(root, 'llm/skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview\n');
    write(root, 'llm/skills/review/scripts/check.sh', '#!/bin/sh\necho ok\n');
    // What 0.18 left in .cursor/skills: a generated copy, an identical script, a file someone added,
    // and a hand-written skill of their own.
    write(
      root,
      '.cursor/skills/review/SKILL.md',
      withGeneratedBanner('---\nname: review\ndescription: Review\n---\nReview\n', 'skills/review/SKILL.md'),
    );
    write(root, '.cursor/skills/review/scripts/check.sh', '#!/bin/sh\necho ok\n');
    write(root, '.cursor/skills/review/my-notes.md', 'mine\n');
    write(root, '.cursor/skills/mine/SKILL.md', '---\nname: mine\ndescription: Mine\n---\nMine\n');
    const cfg = config(['cursor', 'claude', 'copilot']);

    const logs: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    try {
      await sync(root, { config: cfg });
      expect(logs.join('\n')).toMatch(/\.cursor\/skills\/ still holds old generated copies/);

      const check = await sync(root, { config: cfg, check: true, silent: true });
      expect(check.stale).toBe(2);

      logs.length = 0;
      const pruned = await sync(root, { config: cfg, prune: true });
      expect(pruned.errors).toEqual([]);
      expect(logs.join('\n')).toMatch(/Removed the generated copies from \.cursor\/skills\//);

      logs.length = 0;
      await sync(root, { config: cfg });
      expect(logs.join('\n')).not.toMatch(/per-tool copies/);
    } finally {
      console.log = log;
    }

    expect(existsSync(join(root, '.cursor/skills/review/SKILL.md'))).toBe(false);
    expect(existsSync(join(root, '.cursor/skills/review/scripts'))).toBe(false);
    expect(read(root, '.cursor/skills/review/my-notes.md')).toBe('mine\n');
    expect(read(root, '.cursor/skills/mine/SKILL.md')).toContain('Mine');
    expect(existsSync(join(root, '.claude/skills/review/scripts/check.sh'))).toBe(true);
    expect(existsSync(join(root, '.github/skills/review/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.agents/skills'))).toBe(false);
  });

  it('never prunes the live skills through a retired dir symlinked to them', async () => {
    write(root, 'llm/skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview\n');
    write(root, 'llm/skills/review/scripts/run.sh', 'echo ok\n');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    mkdirSync(join(root, '.cursor'), { recursive: true });
    symlinkSync(join('..', '.claude', 'skills'), join(root, '.cursor', 'skills'), 'dir');
    const cfg = config(['cursor', 'claude']);

    await sync(root, { config: cfg, prune: true, silent: true });

    expect(existsSync(join(root, '.claude/skills/review/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/skills/review/scripts/run.sh'))).toBe(true);
    expect((await sync(root, { config: cfg, check: true, silent: true })).outOfSync).toBe(0);
  });

  it('uninstall removes a retired copy whose files match a live copy, and keeps added files', async () => {
    write(root, 'bluetemberg.config.json', JSON.stringify(config(['cursor', 'claude'])));
    write(root, 'llm/skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview\n');
    write(root, 'llm/skills/review/scripts/run.sh', 'echo ok\n');
    await sync(root, { silent: true });
    write(
      root,
      '.cursor/skills/review/SKILL.md',
      withGeneratedBanner('---\nname: review\n---\nOld\n', 'skills/review/SKILL.md'),
    );
    write(root, '.cursor/skills/review/scripts/run.sh', 'echo ok\n');
    write(root, '.cursor/skills/review/mine.md', 'mine\n');

    await uninstall(root);

    expect(existsSync(join(root, '.cursor/skills/review/SKILL.md'))).toBe(false);
    expect(existsSync(join(root, '.cursor/skills/review/scripts'))).toBe(false);
    expect(read(root, '.cursor/skills/review/mine.md')).toBe('mine\n');
    expect(existsSync(join(root, '.claude/skills/review'))).toBe(false);
  });

  it('warns once when an explicit targets.skills leaves out a platform that reads skills', async () => {
    write(root, 'llm/skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview\n');
    // What `init` wrote before Gemini CLI got a skills dir.
    const upgraded = config(['cursor', 'claude', 'gemini'], {
      skills: { cursor: { dir: '.cursor/skills' }, claude: { dir: '.claude/skills' } },
    });

    const results = await sync(root, { config: upgraded, silent: true });

    const missing = results.warnings.filter((w) => w.includes('gets no skills'));
    expect(missing).toEqual([
      expect.stringContaining('Add "gemini": {"dir": ".agents/skills"} to targets.skills'),
    ]);
    // Cursor reads Claude's dir, so it is served and not warned about.
    expect(missing[0]).toMatch(/^gemini /);

    const defaults = await sync(root, { config: config(['cursor', 'claude', 'gemini']), silent: true });
    expect(defaults.warnings.some((w) => w.includes('gets no skills'))).toBe(false);
  });

  it('never overwrites a hand-written skill in a shared dir', async () => {
    write(root, 'llm/skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview\n');
    write(root, '.agents/skills/review/SKILL.md', '---\nname: review\ndescription: Mine\n---\nMine\n');

    const results = await sync(root, { config: config(['codex']), silent: true });

    expect(read(root, '.agents/skills/review/SKILL.md')).toContain('Mine');
    expect(
      results.warnings.some((w) =>
        w.includes('.agents/skills/review/ holds a skill bluetemberg did not write'),
      ),
    ).toBe(true);
  });

  it('keeps the per-host user-only switches in the shared dir', async () => {
    write(root, 'llm/commands/ship.md', '# Ship\n');

    await sync(root, { config: config(['cursor', 'claude', 'devin', 'codex']), silent: true });

    const shared = matter(stripGeneratedBanner(read(root, '.agents/skills/ship/SKILL.md'))).data;
    expect(shared['disable-model-invocation']).toBe(true);
    expect(shared.triggers).toEqual(['user']);
    expect(read(root, '.agents/skills/ship/agents/openai.yaml')).toContain(
      'allow_implicit_invocation: false',
    );
    expect(
      matter(stripGeneratedBanner(read(root, '.claude/skills/ship/SKILL.md'))).data.triggers,
    ).toBeUndefined();
  });

  it('does not write a Claude agent whose name Claude Code would skip', async () => {
    write(root, 'llm/agents/bad.md', '---\nname: ns:bad\ndescription: Bad\n---\nBad\n');
    write(root, 'llm/agents/good.md', '---\nname: good\ndescription: Good\n---\nGood\n');

    const results = await sync(root, { config: config(['claude', 'cursor']), silent: true });

    expect(existsSync(join(root, '.claude/agents/bad.md'))).toBe(false);
    expect(existsSync(join(root, '.claude/agents/good.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor/agents/bad.md'))).toBe(true);
    expect(results.warnings.some((w) => w.startsWith('agents/bad.md:'))).toBe(true);
  });
});
