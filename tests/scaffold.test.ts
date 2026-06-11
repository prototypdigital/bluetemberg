import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/init/scaffold.js';
import type { InitAnswers } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const baseAnswers: InitAnswers = {
  teamProfile: 'frontend',
  projectName: 'My Project',
  projectDescription: 'A test project.',
  packageManager: 'npm',
  platforms: ['cursor', 'claude', 'copilot'],
  ruleSource: 'collections',
  rules: [],
  ruleCollections: ['typescript', 'git'],
  includeAgents: false,
  agents: [],
  includeSkills: false,
  skills: [],
  includeMcp: false,
  mcpServers: [],
};

describe('scaffold', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('bluetemberg.config.json', () => {
    it('creates config with selected platforms and source', () => {
      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.platforms).toEqual(['cursor', 'claude', 'copilot']);
      expect(config.source).toBe('llm');
    });

    it('records the selected team profile in the config', () => {
      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.profile).toBe('frontend');
    });

    it('includes rules targets when rules are selected', () => {
      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules?.cursor).toEqual({ dir: '.cursor/rules', ext: '.mdc' });
      expect(config.targets.rules?.claude).toEqual({ dir: '.claude/rules', ext: '.md' });
      expect(config.targets.rules?.copilot).toEqual({
        dir: '.github/instructions',
        ext: '.instructions.md',
      });
    });

    it('omits rules targets when no rules or collections are selected', () => {
      scaffold(root, { ...baseAnswers, rules: [], ruleCollections: [] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules).toBeUndefined();
    });

    it('includes agents targets only when includeAgents is true with agents selected', () => {
      scaffold(root, { ...baseAnswers, includeAgents: true, agents: ['frontend-specialist'] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.agents?.cursor).toBeDefined();
      expect(config.targets.agents?.claude).toBeDefined();
    });

    it('omits agents targets when includeAgents is false', () => {
      scaffold(root, { ...baseAnswers, includeAgents: false, agents: ['frontend-specialist'] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.agents).toBeUndefined();
    });

    it('includes skills targets only when includeSkills is true with skills selected', () => {
      scaffold(root, { ...baseAnswers, includeSkills: true, skills: ['patterns'] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.skills?.cursor).toEqual({ dir: '.cursor/skills' });
      expect(config.targets.skills?.claude).toEqual({ dir: '.claude/skills' });
    });

    it('includes gemini rules target when gemini is in platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['gemini'] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules?.gemini).toEqual({ dir: '.gemini/context', ext: '.md' });
    });

    it('only includes targets for selected platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['cursor'] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules?.cursor).toBeDefined();
      expect(config.targets.rules?.claude).toBeUndefined();
      expect(config.targets.rules?.copilot).toBeUndefined();
    });

    it('does not include adapters field in a fresh config', () => {
      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.adapters).toBeUndefined();
    });

    it('preserves existing adapters when config already exists', () => {
      writeFileSync(
        join(root, 'bluetemberg.config.json'),
        JSON.stringify({
          platforms: ['cursor'],
          source: 'llm',
          targets: {},
          adapters: ['my-custom-adapter'],
        }),
      );

      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.adapters).toEqual(['my-custom-adapter']);
    });
  });

  describe('rule collections', () => {
    const collectionsAnswers: InitAnswers = {
      ...baseAnswers,
      ruleSource: 'collections',
      rules: [],
      ruleCollections: ['typescript', 'git'],
    };

    it('writes llm/packages.json with selected collection package names', () => {
      scaffold(root, collectionsAnswers);

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-rules-typescript']).toBeDefined();
      expect(manifest.packages['bluetemberg-rules-git']).toBeDefined();
    });

    it('writes semver ranges, not exact pins', () => {
      scaffold(root, collectionsAnswers);

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-rules-typescript']).toBe('^0.1.0');
      expect(manifest.packages['bluetemberg-rules-git']).toBe('^0.1.0');
    });

    it('does not create llm/packages.json when nothing resolves to a package', () => {
      scaffold(root, { ...collectionsAnswers, ruleCollections: [] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('does not copy rule templates into llm/rules/ when ruleSource is collections', () => {
      scaffold(root, collectionsAnswers);

      expect(existsSync(join(root, 'llm', 'rules', 'coding-standards.md'))).toBe(false);
    });

    it('includes rules targets in config when collections are selected', () => {
      scaffold(root, collectionsAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules?.cursor).toBeDefined();
    });

    it('omits rules targets in config when collections list is empty', () => {
      scaffold(root, { ...collectionsAnswers, ruleCollections: [] });

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules).toBeUndefined();
    });

    it('skips unknown collection ids gracefully', () => {
      scaffold(root, { ...collectionsAnswers, ruleCollections: ['typescript', 'nonexistent'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-rules-typescript']).toBeDefined();
      expect(Object.keys(manifest.packages)).toHaveLength(1);
    });

    it('writes rules, agents, and skills into a single manifest', () => {
      scaffold(root, {
        ...collectionsAnswers,
        includeAgents: true,
        agents: ['frontend-specialist'],
        includeSkills: true,
        skills: ['patterns'],
      });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-rules-typescript']).toBeDefined();
      expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBeDefined();
      expect(manifest.packages['bluetemberg-skills-patterns']).toBeDefined();
    });

    it('does not write legacy kind-split manifests', () => {
      scaffold(root, {
        ...collectionsAnswers,
        includeAgents: true,
        agents: ['frontend-specialist'],
        includeSkills: true,
        skills: ['patterns'],
      });

      expect(existsSync(join(root, 'llm', 'rule-packages.json'))).toBe(false);
      expect(existsSync(join(root, 'llm', 'agent-packages.json'))).toBe(false);
      expect(existsSync(join(root, 'llm', 'skill-packages.json'))).toBe(false);
    });
  });

  describe('empty rule source (none)', () => {
    const noneAnswers: InitAnswers = {
      ...baseAnswers,
      ruleSource: 'none',
      rules: [],
      ruleCollections: [],
    };

    it('creates the llm/rules/ directory', () => {
      scaffold(root, noneAnswers);

      expect(existsSync(join(root, 'llm', 'rules'))).toBe(true);
    });

    it('writes a .gitkeep so the empty llm/rules/ survives a commit', () => {
      scaffold(root, noneAnswers);

      expect(existsSync(join(root, 'llm', 'rules', '.gitkeep'))).toBe(true);
    });

    it('does not copy any rule templates into llm/rules/', () => {
      scaffold(root, noneAnswers);

      expect(existsSync(join(root, 'llm', 'rules', 'coding-standards.md'))).toBe(false);
    });

    it('does not create llm/packages.json', () => {
      scaffold(root, noneAnswers);

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('omits rules targets in config when no rules or collections are selected', () => {
      scaffold(root, noneAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.targets.rules).toBeUndefined();
    });

    it('still scaffolds config and AGENTS.md', () => {
      scaffold(root, noneAnswers);

      expect(existsSync(join(root, 'bluetemberg.config.json'))).toBe(true);
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    });
  });

  describe('agents', () => {
    const agentsOnlyAnswers: InitAnswers = { ...baseAnswers, ruleSource: 'none', ruleCollections: [] };

    it('writes selected agent packages into llm/packages.json', () => {
      scaffold(root, { ...agentsOnlyAnswers, includeAgents: true, agents: ['frontend-specialist'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBeDefined();
    });

    it('writes semver ranges, not exact pins', () => {
      scaffold(root, { ...agentsOnlyAnswers, includeAgents: true, agents: ['frontend-specialist'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBe('^0.1.0');
    });

    it('omits agent packages when includeAgents is false', () => {
      scaffold(root, { ...agentsOnlyAnswers, includeAgents: false, agents: ['frontend-specialist'] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('omits agent packages when agents list is empty', () => {
      scaffold(root, { ...agentsOnlyAnswers, includeAgents: true, agents: [] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('skips agents with unknown IDs gracefully', () => {
      scaffold(root, { ...agentsOnlyAnswers, includeAgents: true, agents: ['nonexistent-agent'] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('writes multiple agents into the manifest', () => {
      scaffold(root, {
        ...agentsOnlyAnswers,
        includeAgents: true,
        agents: ['frontend-specialist', 'test-specialist'],
      });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-agents-frontend-specialist']).toBeDefined();
      expect(manifest.packages['bluetemberg-agents-test-specialist']).toBeDefined();
    });
  });

  describe('skills', () => {
    const skillsOnlyAnswers: InitAnswers = { ...baseAnswers, ruleSource: 'none', ruleCollections: [] };

    it('writes selected skill packages into llm/packages.json', () => {
      scaffold(root, { ...skillsOnlyAnswers, includeSkills: true, skills: ['patterns'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-skills-patterns']).toBeDefined();
    });

    it('writes semver ranges, not exact pins', () => {
      scaffold(root, { ...skillsOnlyAnswers, includeSkills: true, skills: ['patterns'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-skills-patterns']).toBe('^0.1.0');
    });

    it('omits skill packages when includeSkills is false', () => {
      scaffold(root, { ...skillsOnlyAnswers, includeSkills: false, skills: ['patterns'] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('omits skill packages when skills list is empty', () => {
      scaffold(root, { ...skillsOnlyAnswers, includeSkills: true, skills: [] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('skips skills with unknown IDs gracefully', () => {
      scaffold(root, { ...skillsOnlyAnswers, includeSkills: true, skills: ['nonexistent-skill'] });

      expect(existsSync(join(root, 'llm', 'packages.json'))).toBe(false);
    });

    it('writes multiple skills into the manifest', () => {
      scaffold(root, {
        ...skillsOnlyAnswers,
        includeSkills: true,
        skills: ['patterns', 'docs-upkeep'],
      });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-skills-patterns']).toBeDefined();
      expect(manifest.packages['bluetemberg-skills-docs-upkeep']).toBeDefined();
    });
  });

  describe('AGENTS.md', () => {
    it('creates AGENTS.md with project name and description', () => {
      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('# My Project');
      expect(content).toContain('A test project.');
    });

    it('includes sync command using the selected package manager', () => {
      scaffold(root, { ...baseAnswers, packageManager: 'pnpm' });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('pnpm sync:llm-config');
    });

    it('uses "npm run" prefix for npm package manager', () => {
      scaffold(root, { ...baseAnswers, packageManager: 'npm' });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('npm run sync:llm-config');
    });

    it('mentions llm/agents/ section when includeAgents is true', () => {
      scaffold(root, { ...baseAnswers, includeAgents: true, agents: ['frontend-specialist'] });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('llm/agents/');
    });

    it('does not mention llm/agents/ when includeAgents is false', () => {
      scaffold(root, { ...baseAnswers, includeAgents: false });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).not.toContain('llm/agents/');
    });

    it('lists active platform output directories', () => {
      scaffold(root, { ...baseAnswers, platforms: ['cursor', 'claude'] });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('.cursor/rules/');
      expect(content).toContain('.claude/rules/');
      expect(content).not.toContain('.github/instructions/');
    });

    it('lists .gemini/context/ when gemini is in platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['gemini'] });

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('.gemini/context/');
    });
  });

  describe('CLAUDE.md', () => {
    it('creates CLAUDE.md when claude is in platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['claude'] });

      expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
      const content = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
      expect(content).toContain('@AGENTS.md');
    });

    it('does not create CLAUDE.md when claude is not in platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['cursor', 'copilot'] });

      expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    });

    it('includes llm/agents/ in CLAUDE.md sync instruction when includeAgents is true', () => {
      scaffold(root, {
        ...baseAnswers,
        platforms: ['claude'],
        includeAgents: true,
        agents: ['frontend-specialist'],
      });

      const content = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
      expect(content).toContain('llm/agents/');
    });
  });

  describe('MCP', () => {
    it('creates llm/mcp.json when includeMcp is true and servers are selected', () => {
      scaffold(root, { ...baseAnswers, includeMcp: true, mcpServers: ['interactive', 'context7'] });

      const mcp = JSON.parse(readFileSync(join(root, 'llm', 'mcp.json'), 'utf8'));
      expect(mcp.servers).toEqual(['interactive', 'context7']);
    });

    it('does not create llm/mcp.json when mcpServers is empty', () => {
      scaffold(root, { ...baseAnswers, includeMcp: true, mcpServers: [] });

      expect(existsSync(join(root, 'llm', 'mcp.json'))).toBe(false);
    });

    it('does not create llm/mcp.json when includeMcp is false', () => {
      scaffold(root, { ...baseAnswers, includeMcp: false, mcpServers: ['interactive'] });

      expect(existsSync(join(root, 'llm', 'mcp.json'))).toBe(false);
    });
  });

  describe('package.json scripts', () => {
    it('adds sync scripts to existing package.json', () => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'my-project', scripts: { build: 'tsc' } }, null, 2),
      );

      scaffold(root, baseAnswers);

      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts['sync:llm-config']).toBe('npx bluetemberg sync');
      expect(pkg.scripts['sync:llm-config:check']).toBe('npx bluetemberg sync --check');
      expect(pkg.scripts.build).toBe('tsc');
    });

    it('does not fail when package.json does not exist', () => {
      expect(() => scaffold(root, baseAnswers)).not.toThrow();
    });

    it('creates scripts object if package.json has none', () => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-project' }, null, 2));

      scaffold(root, baseAnswers);

      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts['sync:llm-config']).toBe('npx bluetemberg sync');
    });
  });

  describe('.prettierignore', () => {
    it('creates .prettierignore with llm/ and docs/wiki/ when it does not exist', () => {
      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, '.prettierignore'), 'utf8');
      expect(content).toContain('llm/');
      expect(content).toContain('docs/wiki/');
    });

    it('appends missing entries to existing .prettierignore', () => {
      writeFileSync(join(root, '.prettierignore'), 'dist/\nnode_modules/\n');

      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, '.prettierignore'), 'utf8');
      expect(content).toContain('dist/');
      expect(content).toContain('node_modules/');
      expect(content).toContain('llm/');
      expect(content).toContain('docs/wiki/');
    });

    it('does not duplicate entries already present in .prettierignore', () => {
      writeFileSync(join(root, '.prettierignore'), 'llm/\ndocs/wiki/\n');

      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, '.prettierignore'), 'utf8');
      const occurrences = (content.match(/llm\//g) ?? []).length;
      expect(occurrences).toBe(1);
    });

    it('does not add plugins/ when claude-marketplace is not in platforms', () => {
      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, '.prettierignore'), 'utf8');
      expect(content).not.toContain('plugins/');
    });

    it('adds plugins/ when claude-marketplace is in platforms', () => {
      scaffold(root, { ...baseAnswers, platforms: ['cursor', 'claude-marketplace'] });

      const content = readFileSync(join(root, '.prettierignore'), 'utf8');
      expect(content).toContain('plugins/');
    });
  });

  describe('claude-marketplace', () => {
    const marketplaceAnswers: InitAnswers = {
      ...baseAnswers,
      platforms: ['cursor', 'claude-marketplace'],
      projectName: 'my-plugin',
    };

    it('adds marketplace.plugins block to config when claude-marketplace is selected', () => {
      scaffold(root, marketplaceAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.marketplace).toBeDefined();
      expect(config.marketplace.plugins).toHaveLength(1);
      expect(config.marketplace.plugins[0].name).toBe('my-plugin');
    });

    it('does not add redundant displayName equal to name', () => {
      scaffold(root, marketplaceAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.marketplace.plugins[0].displayName).toBeUndefined();
    });

    it('omits marketplace from config when claude-marketplace is not in platforms', () => {
      scaffold(root, baseAnswers);

      const config = JSON.parse(readFileSync(join(root, 'bluetemberg.config.json'), 'utf8'));
      expect(config.marketplace).toBeUndefined();
    });

    it('lists plugins/ in AGENTS.md when claude-marketplace is in platforms', () => {
      scaffold(root, marketplaceAnswers);

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).toContain('`plugins/`');
    });

    it('does not list plugins/ in AGENTS.md when claude-marketplace is not in platforms', () => {
      scaffold(root, baseAnswers);

      const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(content).not.toContain('`plugins/`');
    });
  });

  describe('return value', () => {
    it('returns an array of created file paths', () => {
      const created = scaffold(root, baseAnswers);

      expect(Array.isArray(created)).toBe(true);
      expect(created.length).toBeGreaterThan(0);
      expect(created.every((p) => typeof p === 'string')).toBe(true);
    });

    it('includes bluetemberg.config.json in created files', () => {
      const created = scaffold(root, baseAnswers);

      expect(created.some((p) => p.endsWith('bluetemberg.config.json'))).toBe(true);
    });

    it('includes AGENTS.md in created files', () => {
      const created = scaffold(root, baseAnswers);

      expect(created.some((p) => p.endsWith('AGENTS.md'))).toBe(true);
    });
  });

  describe('guardrails', () => {
    it('adds the guardrail package to llm/packages.json when selected', () => {
      scaffold(root, {
        ...baseAnswers,
        includeGuardrails: true,
        guardrails: ['conventional-branch-names'],
      });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-guardrails-git']).toBe('^0.1.0');
    });

    it('does not copy guardrail files into llm/guardrails/', () => {
      scaffold(root, {
        ...baseAnswers,
        includeGuardrails: true,
        guardrails: ['conventional-branch-names'],
      });

      expect(existsSync(join(root, 'llm', 'guardrails'))).toBe(false);
    });

    it('omits the guardrail package when includeGuardrails is false', () => {
      scaffold(root, { ...baseAnswers, includeGuardrails: false, guardrails: ['conventional-branch-names'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-guardrails-git']).toBeUndefined();
    });

    it('omits the guardrail package when guardrails array is empty', () => {
      scaffold(root, { ...baseAnswers, includeGuardrails: true, guardrails: [] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-guardrails-git']).toBeUndefined();
    });

    it('omits the guardrail package when guardrails fields are absent', () => {
      scaffold(root, baseAnswers);

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-guardrails-git']).toBeUndefined();
    });

    it('skips unknown guardrail ids gracefully', () => {
      scaffold(root, { ...baseAnswers, includeGuardrails: true, guardrails: ['nonexistent-guardrail'] });

      const manifest = JSON.parse(readFileSync(join(root, 'llm', 'packages.json'), 'utf8'));
      expect(manifest.packages['bluetemberg-guardrails-git']).toBeUndefined();
    });
  });
});
