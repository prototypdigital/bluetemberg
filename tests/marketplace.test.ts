import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-marketplace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(root: string, name: string, frontmatter = ''): void {
  mkdirSync(join(root, 'llm', 'skills', name), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeAgent(root: string, name: string, frontmatter = ''): void {
  mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'agents', `${name}.md`),
    `---\nname: ${name}\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

const BASE_CONFIG: BlueprintConfig = {
  platforms: ['claude-marketplace'],
  source: 'llm',
  targets: {},
};

describe('syncMarketplace', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits default single plugin containing all skills and agents', async () => {
    writeSkill(root, 'api-design');
    writeAgent(root, 'backend-specialist');

    const projectName = basename(root);
    const results = await sync(root, { config: BASE_CONFIG, silent: true });

    // 1 SKILL.md + 1 agent.md + 1 plugin.json + 1 marketplace.json
    expect(results.synced).toBe(4);
    expect(results.errors).toHaveLength(0);

    expect(existsSync(join(root, `plugins/${projectName}/skills/api-design/SKILL.md`))).toBe(true);
    expect(existsSync(join(root, `plugins/${projectName}/agents/backend-specialist.md`))).toBe(true);
    expect(existsSync(join(root, `plugins/${projectName}/.claude-plugin/plugin.json`))).toBe(true);
    expect(existsSync(join(root, '.claude-plugin/marketplace.json'))).toBe(true);
  });

  it('plugin.json contains correct skill and agent entries', async () => {
    writeSkill(root, 'api-design');
    writeAgent(root, 'backend-specialist');

    const projectName = basename(root);
    await sync(root, { config: BASE_CONFIG, silent: true });

    const pluginJson = JSON.parse(
      readFileSync(join(root, `plugins/${projectName}/.claude-plugin/plugin.json`), 'utf8'),
    );

    expect(pluginJson.name).toBe(projectName);
    expect(pluginJson.skills).toHaveLength(1);
    expect(pluginJson.skills[0].name).toBe('api-design');
    expect(pluginJson.skills[0].path).toBe(`plugins/${projectName}/skills/api-design/SKILL.md`);
    expect(pluginJson.agents).toHaveLength(1);
    expect(pluginJson.agents[0].name).toBe('backend-specialist');
    expect(pluginJson.agents[0].path).toBe(`plugins/${projectName}/agents/backend-specialist.md`);
  });

  it('marketplace.json lists all plugins', async () => {
    writeSkill(root, 'api-design');

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [
          { name: 'frontend', displayName: 'Frontend Developer' },
          { name: 'devops', displayName: 'DevOps Engineer' },
        ],
      },
    };

    await sync(root, { config, silent: true });

    const marketplaceJson = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));

    expect(marketplaceJson.plugins).toHaveLength(2);
    expect(marketplaceJson.plugins[0].name).toBe('frontend');
    expect(marketplaceJson.plugins[0].path).toBe('plugins/frontend');
    expect(marketplaceJson.plugins[1].name).toBe('devops');
  });

  it('emits multiple plugins from marketplace config', async () => {
    writeSkill(root, 'api-design');
    writeAgent(root, 'backend-specialist');

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [
          { name: 'frontend', displayName: 'Frontend Developer' },
          { name: 'devops', displayName: 'DevOps Engineer' },
        ],
      },
    };

    const results = await sync(root, { config, silent: true });

    // 2 plugins × (1 skill + 1 agent + 1 plugin.json) + 1 marketplace.json
    expect(results.synced).toBe(7);

    expect(existsSync(join(root, 'plugins/frontend/skills/api-design/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/frontend/agents/backend-specialist.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/frontend/.claude-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, 'plugins/devops/skills/api-design/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/devops/.claude-plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.claude-plugin/marketplace.json'))).toBe(true);
  });

  it('profile filtering: tagged files only go into plugins with a matching profile', async () => {
    writeSkill(root, 'api-design', 'profiles:\n  - backend\n  - fullstack');
    writeSkill(root, 'ci-cd', 'profiles:\n  - devops');
    writeSkill(root, 'universal-skill'); // no profiles — goes everywhere

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [
          { name: 'backend', profiles: ['backend', 'fullstack'] },
          { name: 'devops', profiles: ['devops', 'pure-infra'] },
        ],
      },
    };

    await sync(root, { config, silent: true });

    // backend plugin: api-design (matches) + universal-skill (universal) — NOT ci-cd
    expect(existsSync(join(root, 'plugins/backend/skills/api-design/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/backend/skills/universal-skill/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/backend/skills/ci-cd/SKILL.md'))).toBe(false);

    // devops plugin: ci-cd (matches) + universal-skill (universal) — NOT api-design
    expect(existsSync(join(root, 'plugins/devops/skills/ci-cd/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/devops/skills/universal-skill/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/devops/skills/api-design/SKILL.md'))).toBe(false);
  });

  it('plugin with no profiles includes all files regardless of their profile tags', async () => {
    writeSkill(root, 'api-design', 'profiles:\n  - backend');
    writeSkill(root, 'ci-cd', 'profiles:\n  - devops');

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [{ name: 'all-skills' }], // no profiles = include everything
      },
    };

    await sync(root, { config, silent: true });

    expect(existsSync(join(root, 'plugins/all-skills/skills/api-design/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins/all-skills/skills/ci-cd/SKILL.md'))).toBe(true);
  });

  it('check mode: reports outOfSync when files are missing', async () => {
    writeSkill(root, 'api-design');

    const results = await sync(root, { config: BASE_CONFIG, check: true, silent: true });

    expect(results.outOfSync).toBeGreaterThan(0);
    expect(results.synced).toBe(0);
  });

  it('check mode: reports in-sync after a normal sync', async () => {
    writeSkill(root, 'api-design');

    await sync(root, { config: BASE_CONFIG, silent: true });

    const checkResults = await sync(root, { config: BASE_CONFIG, check: true, silent: true });
    expect(checkResults.outOfSync).toBe(0);
  });

  it('returns early with no output when there are no skills or agents', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });

    const results = await sync(root, { config: BASE_CONFIG, silent: true });

    expect(results.synced).toBe(0);
    expect(existsSync(join(root, '.claude-plugin'))).toBe(false);
  });

  describe('preset-based profile resolution', () => {
    it('skill with a known preset ID and no frontmatter resolves profiles from presets', async () => {
      // 'patterns' is in SKILL_PRESETS with tags: ['frontend', 'backend', 'fullstack']
      writeSkill(root, 'patterns'); // no profiles frontmatter

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: {
          plugins: [
            { name: 'frontend-plugin', profiles: ['frontend'] },
            { name: 'devops-plugin', profiles: ['devops', 'pure-infra'] },
          ],
        },
      };

      await sync(root, { config, silent: true });

      // 'patterns' matches frontend — should appear in frontend-plugin
      expect(existsSync(join(root, 'plugins/frontend-plugin/skills/patterns/SKILL.md'))).toBe(true);
      // 'patterns' has no devops tag — should NOT appear in devops-plugin
      expect(existsSync(join(root, 'plugins/devops-plugin/skills/patterns/SKILL.md'))).toBe(false);
    });

    it('agent with a known preset ID and no frontmatter resolves profiles from presets', async () => {
      // 'frontend-specialist' is in AGENT_PRESETS with tags: ['frontend', 'fullstack']
      writeAgent(root, 'frontend-specialist'); // no profiles frontmatter

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: {
          plugins: [
            { name: 'frontend-plugin', profiles: ['frontend'] },
            { name: 'devops-plugin', profiles: ['devops'] },
          ],
        },
      };

      await sync(root, { config, silent: true });

      expect(existsSync(join(root, 'plugins/frontend-plugin/agents/frontend-specialist.md'))).toBe(true);
      expect(existsSync(join(root, 'plugins/devops-plugin/agents/frontend-specialist.md'))).toBe(false);
    });

    it('frontmatter profiles take priority over preset lookup', async () => {
      // 'patterns' is in SKILL_PRESETS as frontend/backend/fullstack — override to devops only
      writeSkill(root, 'patterns', 'profiles:\n  - devops');

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: {
          plugins: [
            { name: 'frontend-plugin', profiles: ['frontend'] },
            { name: 'devops-plugin', profiles: ['devops'] },
          ],
        },
      };

      await sync(root, { config, silent: true });

      expect(existsSync(join(root, 'plugins/devops-plugin/skills/patterns/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, 'plugins/frontend-plugin/skills/patterns/SKILL.md'))).toBe(false);
    });

    it('unknown preset ID with no frontmatter is treated as universal', async () => {
      writeSkill(root, 'my-custom-skill'); // not in any preset, no frontmatter

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: {
          plugins: [
            { name: 'frontend-plugin', profiles: ['frontend'] },
            { name: 'devops-plugin', profiles: ['devops'] },
          ],
        },
      };

      await sync(root, { config, silent: true });

      // universal — appears in all plugins
      expect(existsSync(join(root, 'plugins/frontend-plugin/skills/my-custom-skill/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, 'plugins/devops-plugin/skills/my-custom-skill/SKILL.md'))).toBe(true);
    });
  });

  it('does not include README.md from agents directory', async () => {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(join(root, 'llm', 'agents', 'README.md'), '# Agents\n');
    writeAgent(root, 'my-agent');

    const projectName = basename(root);
    await sync(root, { config: BASE_CONFIG, silent: true });

    expect(existsSync(join(root, `plugins/${projectName}/agents/README.md`))).toBe(false);
    expect(existsSync(join(root, `plugins/${projectName}/agents/my-agent.md`))).toBe(true);
  });

  describe('remote + extraKnownMarketplaces', () => {
    it('writes extraKnownMarketplaces to .claude/settings.json when remote is set', async () => {
      writeSkill(root, 'api-design');

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: { remote: 'prototypdigital/claude-marketplace' },
      };

      await sync(root, { config, silent: true });

      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
      expect(settings.extraKnownMarketplaces).toContain('prototypdigital/claude-marketplace');
    });

    it('preserves existing settings keys when writing extraKnownMarketplaces', async () => {
      writeSkill(root, 'api-design');
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'settings.json'),
        JSON.stringify({ theme: 'dark', extraKnownMarketplaces: ['other/repo'] }, null, 2),
      );

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: { remote: 'prototypdigital/claude-marketplace' },
      };

      await sync(root, { config, silent: true });

      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
      expect(settings.theme).toBe('dark');
      expect(settings.extraKnownMarketplaces).toContain('other/repo');
      expect(settings.extraKnownMarketplaces).toContain('prototypdigital/claude-marketplace');
    });

    it('does not duplicate the remote entry on repeated syncs', async () => {
      writeSkill(root, 'api-design');

      const config: BlueprintConfig = {
        ...BASE_CONFIG,
        marketplace: { remote: 'prototypdigital/claude-marketplace' },
      };

      await sync(root, { config, silent: true });
      await sync(root, { config, silent: true });

      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
      const count = (settings.extraKnownMarketplaces as string[]).filter(
        (v) => v === 'prototypdigital/claude-marketplace',
      ).length;
      expect(count).toBe(1);
    });

    it('does not write settings.json when remote is not set', async () => {
      writeSkill(root, 'api-design');

      await sync(root, { config: BASE_CONFIG, silent: true });

      expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
    });
  });
});
