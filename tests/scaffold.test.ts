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
  rules: ['coding-standards', 'early-returns'],
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

    it('omits rules targets when no rules are selected', () => {
      scaffold(root, { ...baseAnswers, rules: [] });

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

  describe('rules', () => {
    it('copies rule templates into llm/rules/', () => {
      scaffold(root, { ...baseAnswers, rules: ['coding-standards', 'early-returns'] });

      expect(existsSync(join(root, 'llm', 'rules', 'coding-standards.md'))).toBe(true);
      expect(existsSync(join(root, 'llm', 'rules', 'early-returns.md'))).toBe(true);
    });

    it('skips rules with unknown template IDs', () => {
      scaffold(root, { ...baseAnswers, rules: ['coding-standards', 'nonexistent-rule'] });

      expect(existsSync(join(root, 'llm', 'rules', 'coding-standards.md'))).toBe(true);
      expect(existsSync(join(root, 'llm', 'rules', 'nonexistent-rule.md'))).toBe(false);
    });

    it('creates llm/rules/ directory even when rules list is empty', () => {
      scaffold(root, { ...baseAnswers, rules: [] });

      expect(existsSync(join(root, 'llm', 'rules'))).toBe(true);
    });
  });

  describe('agents', () => {
    it('copies agent templates into llm/agents/ when includeAgents is true', () => {
      scaffold(root, { ...baseAnswers, includeAgents: true, agents: ['frontend-specialist'] });

      expect(existsSync(join(root, 'llm', 'agents', 'frontend-specialist.md'))).toBe(true);
    });

    it('does not create llm/agents/ when includeAgents is false', () => {
      scaffold(root, { ...baseAnswers, includeAgents: false, agents: ['frontend-specialist'] });

      expect(existsSync(join(root, 'llm', 'agents'))).toBe(false);
    });

    it('skips agents with unknown template IDs', () => {
      scaffold(root, { ...baseAnswers, includeAgents: true, agents: ['nonexistent-agent'] });

      expect(existsSync(join(root, 'llm', 'agents', 'nonexistent-agent.md'))).toBe(false);
    });
  });

  describe('skills', () => {
    it('copies skill templates into llm/skills/ when includeSkills is true', () => {
      scaffold(root, { ...baseAnswers, includeSkills: true, skills: ['patterns'] });

      expect(existsSync(join(root, 'llm', 'skills', 'patterns', 'SKILL.md'))).toBe(true);
    });

    it('creates llm/skills/ directory even when skills list is empty', () => {
      scaffold(root, { ...baseAnswers, includeSkills: true, skills: [] });

      expect(existsSync(join(root, 'llm', 'skills'))).toBe(true);
    });

    it('does not create llm/skills/ when includeSkills is false', () => {
      scaffold(root, { ...baseAnswers, includeSkills: false, skills: ['patterns'] });

      expect(existsSync(join(root, 'llm', 'skills'))).toBe(false);
    });

    it('skips skills with unknown template IDs', () => {
      scaffold(root, { ...baseAnswers, includeSkills: true, skills: ['nonexistent-skill'] });

      expect(existsSync(join(root, 'llm', 'skills', 'nonexistent-skill'))).toBe(false);
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
});
