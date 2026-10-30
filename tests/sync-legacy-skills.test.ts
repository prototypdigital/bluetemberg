import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { sync } from '../src/sync/index.js';
import { hasGeneratedBanner, stripGeneratedBanner } from '../src/sync/banner.js';
import { toLegacySkillContent } from '../src/sync/legacy-skills.js';
import { uninstall } from '../src/uninstall/index.js';
import type { BlueprintConfig } from '../src/types.js';

const SKILL_DIRS = ['.claude/skills', '.github/skills', '.cursor/skills', '.agents/skills'];

const allSkillPlatforms: BlueprintConfig = {
  platforms: ['claude', 'copilot', 'cursor', 'codex'],
  source: 'llm',
  targets: {},
};

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function frontmatter(content: string): Record<string, unknown> {
  return matter(stripGeneratedBanner(content)).data;
}

describe('toLegacySkillContent', () => {
  it('adds name, description and disable-model-invocation, keeping the body and command fields', () => {
    const source =
      '---\ndescription: Ship it\nallowed-tools: Bash\nargument-hint: "[version]"\n---\n\nShip $ARGUMENTS\n';

    const { name, content, dropped } = toLegacySkillContent(source, 'ship', 'command');

    expect(name).toBe('ship');
    expect(dropped).toEqual([]);
    expect(content).toBe(
      "---\nname: ship\ndescription: Ship it\ndisable-model-invocation: true\nallowed-tools: Bash\nargument-hint: '[version]'\n---\n\nShip $ARGUMENTS\n",
    );
  });

  it('derives a description from the first heading when the source has none', () => {
    const { content } = toLegacySkillContent('# Explain the code\n\nExplain.\n', 'explain', 'prompt');

    expect(matter(content).data).toEqual({
      name: 'explain',
      description: 'Explain the code',
      'disable-model-invocation': true,
    });
    expect(matter(content).content).toBe('# Explain the code\n\nExplain.\n');
  });

  it('falls back to the slash command for an empty body', () => {
    const { content } = toLegacySkillContent('', 'noop', 'command');
    expect(matter(content).data.description).toBe('/noop');
  });

  it('keeps an explicit disable-model-invocation from the source', () => {
    const { content } = toLegacySkillContent(
      '---\ndescription: d\ndisable-model-invocation: false\n---\nx\n',
      'auto',
      'command',
    );
    expect(matter(content).data['disable-model-invocation']).toBe(false);
  });

  it("drops a prompt's agent, mode, model and tools, which skills have no field for", () => {
    const source =
      '---\ndescription: Review\nagent: plan\nmodel: GPT-5\ntools: [search]\nargument-hint: file\n---\nx\n';

    const { content, dropped } = toLegacySkillContent(source, 'review', 'prompt');

    expect(dropped).toEqual(['agent', 'model', 'tools']);
    expect(matter(content).data).toEqual({
      name: 'review',
      description: 'Review',
      'disable-model-invocation': true,
      'argument-hint': 'file',
    });
  });

  it('names a prompt by its name field, which is what VS Code put after the slash', () => {
    const { name, content } = toLegacySkillContent('---\nname: pr-review\n---\nx\n', 'review', 'prompt');
    expect(name).toBe('pr-review');
    expect(matter(content).data.name).toBe('pr-review');
  });

  it('keeps the file name for a command, whose name field never set its slash command', () => {
    const { name } = toLegacySkillContent('---\nname: other\n---\nx\n', 'ship', 'command');
    expect(name).toBe('ship');
  });
});

describe('commands and prompts synced as skills', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-legacy-skills-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes a bannered skill for each command and prompt to every skills target', async () => {
    write(root, 'llm/commands/ship.md', '---\ndescription: Ship it\n---\n\nShip $ARGUMENTS\n');
    write(root, 'llm/prompts/explain.prompt.md', '# Explain\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(results.errors).toEqual([]);
    for (const dir of SKILL_DIRS) {
      const ship = read(root, `${dir}/ship/SKILL.md`);
      expect(hasGeneratedBanner(ship)).toBe(true);
      expect(frontmatter(ship)).toEqual({
        name: 'ship',
        description: 'Ship it',
        'disable-model-invocation': true,
      });
      expect(ship).toContain('from commands/ship.md');
      expect(frontmatter(read(root, `${dir}/explain/SKILL.md`)).name).toBe('explain');
    }
  });

  it('keeps the legacy outputs during the transition', async () => {
    write(root, 'llm/commands/ship.md', '# Ship\n');
    write(root, 'llm/prompts/explain.md', '# Explain\n');

    await sync(root, { config: allSkillPlatforms, silent: true });

    expect(existsSync(join(root, '.claude', 'commands', 'ship.md'))).toBe(true);
    expect(existsSync(join(root, '.github', 'prompts', 'explain.prompt.md'))).toBe(true);
  });

  it('warns once per sync that the legacy outputs are deprecated', async () => {
    write(root, 'llm/commands/a.md', '# A\n');
    write(root, 'llm/commands/b.md', '# B\n');
    write(root, 'llm/prompts/c.md', '# C\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    const deprecations = results.warnings.filter((w) => w.startsWith('Deprecated:'));
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]).toContain('.claude/commands/');
    expect(deprecations[0]).toContain('.github/prompts/');
    expect(deprecations[0]).toContain('0.18.0');
  });

  it('does not warn about an output no enabled platform produces', async () => {
    write(root, 'llm/prompts/c.md', '# C\n');

    const results = await sync(root, {
      config: { platforms: ['claude'], source: 'llm', targets: {} },
      silent: true,
    });

    expect(results.warnings.filter((w) => w.startsWith('Deprecated:'))).toEqual([]);
    expect(existsSync(join(root, '.claude', 'skills', 'c', 'SKILL.md'))).toBe(true);
  });

  it('lets a real skill win a name collision, and warns', async () => {
    write(root, 'llm/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Real\n---\n\nReal.\n');
    write(root, 'llm/commands/deploy.md', '# Command\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(frontmatter(read(root, '.claude/skills/deploy/SKILL.md')).description).toBe('Real');
    expect(results.warnings.some((w) => w.includes('commands/deploy.md') && w.includes('skill wins'))).toBe(
      true,
    );
  });

  it('never overwrites a hand-written skill in an output dir', async () => {
    write(root, '.claude/skills/ship/SKILL.md', '---\nname: ship\ndescription: Mine\n---\n');
    write(root, 'llm/commands/ship.md', '# Ship\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(read(root, '.claude/skills/ship/SKILL.md')).toBe('---\nname: ship\ndescription: Mine\n---\n');
    expect(hasGeneratedBanner(read(root, '.github/skills/ship/SKILL.md'))).toBe(true);
    expect(
      results.warnings.some((w) => w.includes('.claude/skills/ship/ holds files bluetemberg did not write')),
    ).toBe(true);
  });

  it('leaves an output dir alone that holds files but no SKILL.md, so prune cannot delete them', async () => {
    write(root, '.claude/skills/ship/notes.md', '# mine\n');
    write(root, 'llm/commands/ship.md', '# Ship\n');

    await sync(root, { config: allSkillPlatforms, silent: true });
    await sync(root, { config: allSkillPlatforms, prune: true, silent: true });

    expect(existsSync(join(root, '.claude', 'skills', 'ship', 'SKILL.md'))).toBe(false);
    expect(read(root, '.claude/skills/ship/notes.md')).toBe('# mine\n');
  });

  it('lets a skill from extends win over a local command', async () => {
    const shared = mkdtempSync(join(tmpdir(), 'bt-legacy-shared-'));
    try {
      write(shared, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Shared\n---\n\nShared.\n');
      write(root, 'llm/commands/deploy.md', '# Command\n');

      const results = await sync(root, { config: { ...allSkillPlatforms, extends: [shared] }, silent: true });

      expect(frontmatter(read(root, '.claude/skills/deploy/SKILL.md')).description).toBe('Shared');
      expect(results.warnings.some((w) => w.includes('commands/deploy.md') && w.includes('skill wins'))).toBe(
        true,
      );
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  });

  it('warns instead of failing the sync on frontmatter that is not valid YAML', async () => {
    write(root, 'llm/commands/broken.md', '---\ndescription: [unclosed\n---\n\nBody\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(results.errors).toEqual([]);
    expect(existsSync(join(root, '.claude', 'commands', 'broken.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'broken'))).toBe(false);
    expect(
      results.warnings.some((w) => w.includes('commands/broken.md: frontmatter could not be parsed')),
    ).toBe(true);
  });

  it('opts a user-only skill out of implicit invocation in Codex and Devin, and nowhere else', async () => {
    write(root, 'llm/commands/ship.md', '# Ship\n');

    await sync(root, {
      config: { platforms: ['claude', 'codex', 'devin'], source: 'llm', targets: {} },
      silent: true,
    });

    const agentsSkill = read(root, '.agents/skills/ship/SKILL.md');
    expect(frontmatter(agentsSkill).triggers).toEqual(['user']);
    const policy = read(root, '.agents/skills/ship/agents/openai.yaml');
    expect(hasGeneratedBanner(policy)).toBe(true);
    expect(policy).toContain('policy:\n  allow_implicit_invocation: false\n');

    expect(frontmatter(read(root, '.claude/skills/ship/SKILL.md')).triggers).toBeUndefined();
    expect(existsSync(join(root, '.claude', 'skills', 'ship', 'agents'))).toBe(false);
  });

  it('writes no Codex policy for a skill the source makes model-invocable', async () => {
    write(root, 'llm/commands/auto.md', '---\ndescription: d\ndisable-model-invocation: false\n---\nx\n');

    await sync(root, { config: { platforms: ['codex', 'devin'], source: 'llm', targets: {} }, silent: true });

    expect(existsSync(join(root, '.agents', 'skills', 'auto', 'agents', 'openai.yaml'))).toBe(false);
    expect(frontmatter(read(root, '.agents/skills/auto/SKILL.md')).triggers).toBeUndefined();
  });

  it('gives a command and a prompt with the same name one skill, the command', async () => {
    write(root, 'llm/commands/review.md', '# From command\n');
    write(root, 'llm/prompts/review.prompt.md', '# From prompt\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(read(root, '.claude/skills/review/SKILL.md')).toContain('# From command');
    expect(results.warnings.some((w) => w.startsWith('prompts/review.prompt.md: commands/review.md'))).toBe(
      true,
    );
  });

  it('skips a file whose name is not a valid skill name, and warns', async () => {
    write(root, 'llm/commands/My_Command.md', '# X\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(existsSync(join(root, '.claude', 'skills', 'My_Command'))).toBe(false);
    expect(results.warnings.some((w) => w.includes('"My_Command" is not a valid skill name'))).toBe(true);
  });

  it("never lets a prompt's name field escape the skills dir", async () => {
    write(root, 'llm/prompts/evil.md', '---\nname: ../../escape\n---\n# Evil\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(existsSync(join(root, 'escape'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'escape'))).toBe(false);
    expect(results.warnings.some((w) => w.includes('"../../escape" is not a valid skill name'))).toBe(true);
  });

  it('warns about prompt fields the skill leaves out', async () => {
    write(root, 'llm/prompts/review.md', '---\nagent: plan\n---\n# Review\n');

    const results = await sync(root, { config: allSkillPlatforms, silent: true });

    expect(results.warnings.some((w) => w.includes('leaves out agent, which skills have no field for'))).toBe(
      true,
    );
  });

  it('writes nothing for a platform with no skills target', async () => {
    write(root, 'llm/commands/ship.md', '# Ship\n');

    const results = await sync(root, {
      config: { platforms: ['gemini'], source: 'llm', targets: {} },
      silent: true,
    });

    expect(results.errors).toEqual([]);
    expect(existsSync(join(root, '.agents', 'skills', 'ship'))).toBe(false);
  });

  it('is idempotent under sync --check', async () => {
    write(root, 'llm/commands/ship.md', '---\ndescription: Ship\n---\nShip\n');
    write(root, 'llm/prompts/explain.md', '# Explain\n');
    await sync(root, { config: allSkillPlatforms, silent: true });

    const check = await sync(root, { config: allSkillPlatforms, check: true, silent: true });

    expect(check.outOfSync).toBe(0);
    expect(check.stale).toBe(0);
  });

  it('reports a changed command as out of sync in its skill', async () => {
    write(root, 'llm/commands/ship.md', '# Ship\n');
    await sync(root, { config: allSkillPlatforms, silent: true });
    write(root, 'llm/commands/ship.md', '# Ship faster\n');

    const check = await sync(root, { config: allSkillPlatforms, check: true, silent: true });

    // .claude/commands/ship.md plus one SKILL.md per skills dir.
    expect(check.outOfSync).toBe(1 + SKILL_DIRS.length);
  });

  it('prunes the generated skill once its command is gone', async () => {
    write(root, 'llm/commands/keep.md', '# Keep\n');
    write(root, 'llm/commands/drop.md', '# Drop\n');
    await sync(root, { config: allSkillPlatforms, silent: true });
    rmSync(join(root, 'llm', 'commands', 'drop.md'));

    const stale = await sync(root, { config: allSkillPlatforms, check: true, silent: true });
    // .claude/commands/drop.md, one SKILL.md per skills dir, and Codex's agents/openai.yaml.
    expect(stale.stale).toBe(1 + SKILL_DIRS.length + 1);

    await sync(root, { config: allSkillPlatforms, prune: true, silent: true });
    const check = await sync(root, { config: allSkillPlatforms, check: true, silent: true });
    expect(check.stale).toBe(0);
    for (const dir of SKILL_DIRS) {
      expect(existsSync(join(root, dir, 'drop'))).toBe(false);
      expect(existsSync(join(root, dir, 'keep', 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(root, '.claude', 'commands', 'drop.md'))).toBe(false);
  });

  it('is removed by uninstall, which keeps the sources', async () => {
    write(root, 'bluetemberg.config.json', JSON.stringify(allSkillPlatforms));
    write(root, 'llm/commands/ship.md', '# Ship\n');
    await sync(root, { silent: true });

    await uninstall(root);

    for (const dir of SKILL_DIRS) expect(existsSync(join(root, dir, 'ship'))).toBe(false);
    expect(read(root, 'llm/commands/ship.md')).toBe('# Ship\n');
  });
});
