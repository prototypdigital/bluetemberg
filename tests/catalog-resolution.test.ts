import { describe, it, expect } from 'vitest';
import { resolveRuleCollections, resolveAgents, resolveSkills } from '../src/init/presets.js';
import {
  agentsForProfile,
  defaultRuleCollections,
  skillsForProfile,
} from '../src/init/init-answers-from-profile.js';
import type { Catalog } from '../src/catalog/index.js';

function catalogWith(packs: Catalog['packs']): Catalog {
  return { generated: '2026-01-01T00:00:00.000Z', packs };
}

describe('catalog-derived preset resolution', () => {
  it('fills a collection rule ids and profile tags from the matching pack', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-rules-typescript',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['frontend', 'backend', 'fullstack'],
        rules: ['type-safety', 'coding-standards'],
        preview: '',
      },
    ]);

    const ts = resolveRuleCollections(catalog).find((c) => c.id === 'typescript');
    expect(ts?.rules).toEqual(['type-safety', 'coding-standards']);
    expect(ts?.tags).toEqual(['frontend', 'backend', 'fullstack']);
    expect(ts?.universal).toBeUndefined();
  });

  it('marks a universal pack as universal with no tags', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-rules-git',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: true,
        profiles: [],
        rules: ['git-workflow'],
        preview: '',
      },
    ]);

    const git = resolveRuleCollections(catalog).find((c) => c.id === 'git');
    expect(git?.universal).toBe(true);
    expect(git?.tags).toBeUndefined();
    expect(git?.rules).toEqual(['git-workflow']);
  });

  it('derives agent tags from the catalog and marks a universal agent universal', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-agents-frontend-specialist',
        version: '0.1.0',
        description: '',
        kind: 'agents',
        universal: false,
        profiles: ['frontend', 'fullstack'],
        agents: ['frontend-specialist'],
        preview: '',
      },
      {
        name: 'bluetemberg-agents-docs-maintainer',
        version: '0.2.0',
        description: '',
        kind: 'agents',
        universal: true,
        profiles: [],
        agents: ['docs-maintainer'],
        preview: '',
      },
    ]);

    const agents = resolveAgents(catalog);
    expect(agents.find((a) => a.id === 'frontend-specialist')?.tags).toEqual(['frontend', 'fullstack']);

    const docs = agents.find((a) => a.id === 'docs-maintainer');
    expect(docs?.universal).toBe(true);
    expect(docs?.tags).toBeUndefined();
  });

  it('resolves skills the same way and preserves curated defaults', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-skills-patterns',
        version: '0.1.0',
        description: '',
        kind: 'skills',
        universal: false,
        profiles: ['backend'],
        skills: ['patterns'],
        preview: '',
      },
    ]);

    const patterns = resolveSkills(catalog).find((s) => s.id === 'patterns');
    expect(patterns?.tags).toEqual(['backend']);
    expect(patterns?.default).toBe(true); // curated overlay default is preserved
  });

  it('an overlay with no matching pack is excluded from the resolved list', () => {
    expect(resolveRuleCollections(catalogWith([]))).toHaveLength(0);
    expect(resolveAgents(catalogWith([]))).toHaveLength(0);
    expect(resolveSkills(catalogWith([]))).toHaveLength(0);
  });

  it('resolves the design-engineer overlays against the catalog with their profile tag', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-rules-design-craft',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['design-engineer'],
        rules: ['anti-stock-defaults', 'banned-moves-first'],
        preview: '',
      },
      {
        name: 'bluetemberg-agents-design-engineer',
        version: '0.1.0',
        description: '',
        kind: 'agents',
        universal: false,
        profiles: ['design-engineer'],
        agents: ['design-engineer'],
        preview: '',
      },
      {
        name: 'bluetemberg-skills-figma-to-code',
        version: '0.1.0',
        description: '',
        kind: 'skills',
        universal: false,
        profiles: ['design-engineer'],
        skills: ['figma-to-code'],
        preview: '',
      },
      {
        name: 'bluetemberg-skills-design-critique',
        version: '0.1.0',
        description: '',
        kind: 'skills',
        universal: false,
        profiles: ['design-engineer'],
        skills: ['design-critique'],
        preview: '',
      },
    ]);

    const craft = resolveRuleCollections(catalog).find((c) => c.id === 'design-craft');
    expect(craft?.tags).toEqual(['design-engineer']);
    expect(craft?.rules).toEqual(['anti-stock-defaults', 'banned-moves-first']);

    const agent = resolveAgents(catalog).find((a) => a.id === 'design-engineer');
    expect(agent?.tags).toEqual(['design-engineer']);
    expect(agent?.default).toBe(true); // curated flagship default

    const skills = resolveSkills(catalog);
    expect(skills.find((s) => s.id === 'figma-to-code')?.default).toBe(true);
    expect(skills.find((s) => s.id === 'design-critique')?.default).toBe(false);
  });

  it('resolvers skip overlays when their pack is missing from a partial catalog', () => {
    // Catalog has git pack but not typescript pack
    const catalog = catalogWith([
      {
        name: 'bluetemberg-rules-git',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: true,
        profiles: [],
        rules: ['git-workflow'],
        preview: '',
      },
    ]);

    const resolved = resolveRuleCollections(catalog);
    expect(resolved.find((c) => c.id === 'git')).toBeDefined();
    expect(resolved.find((c) => c.id === 'typescript')).toBeUndefined();
  });

  describe('packs without an overlay', () => {
    const none: ReadonlySet<string> = new Set();
    const uncurated = catalogWith([
      {
        name: 'bluetemberg-rules-tailwind',
        version: '0.1.0',
        description: 'Tailwind CSS v4 rules for Bluetemberg — @theme token discipline, fluid typography.',
        kind: 'rules',
        universal: false,
        profiles: ['frontend', 'fullstack'],
        rules: ['tailwind-theme-tokens'],
        preview: '',
      },
      {
        name: 'bluetemberg-agents-payload-specialist',
        version: '0.1.0',
        description: 'Payload CMS specialist agent for Bluetemberg — collections, globals, blocks.',
        kind: 'agents',
        universal: false,
        profiles: ['backend', 'fullstack'],
        agents: ['payload-specialist'],
        preview: '',
      },
      {
        name: 'bluetemberg-skills-create-rule',
        version: '0.1.0',
        description: 'Meta-skill for scaffolding new bluetemberg rules',
        kind: 'skills',
        universal: true,
        profiles: [],
        skills: ['create-rule'],
        preview: '',
      },
      {
        name: 'bluetemberg-guardrails-git',
        version: '0.1.0',
        description: '',
        kind: 'guardrails',
        universal: true,
        profiles: [],
        guardrails: ['conventional-branch-names'],
        preview: '',
      },
    ]);

    it('are offered from the catalog, keyed by package name without the kind prefix', () => {
      const tailwind = resolveRuleCollections(uncurated).find((c) => c.id === 'tailwind');
      expect(tailwind).toMatchObject({
        packageName: 'bluetemberg-rules-tailwind',
        name: 'Tailwind CSS v4 rules',
        description: '@theme token discipline, fluid typography.',
        rules: ['tailwind-theme-tokens'],
        tags: ['frontend', 'fullstack'],
      });

      const payload = resolveAgents(uncurated).find((a) => a.id === 'payload-specialist');
      expect(payload).toMatchObject({
        packageName: 'bluetemberg-agents-payload-specialist',
        name: 'Payload CMS specialist agent',
        default: false,
        tags: ['backend', 'fullstack'],
      });
    });

    it('fall back to the id as the name when the description has no " — " detail', () => {
      const createRule = resolveSkills(uncurated).find((s) => s.id === 'create-rule');
      expect(createRule).toMatchObject({
        name: 'create-rule',
        description: 'Meta-skill for scaffolding new bluetemberg rules',
        universal: true,
      });
    });

    it('are preselected by their catalog profiles, like curated packs', () => {
      expect(defaultRuleCollections('frontend', uncurated, none)).toContain('tailwind');
      expect(defaultRuleCollections('backend', uncurated, none)).not.toContain('tailwind');
      expect(agentsForProfile('backend', uncurated, none)).toContain('payload-specialist');
      expect(agentsForProfile('frontend', uncurated, none)).not.toContain('payload-specialist');
      expect(skillsForProfile('devops', uncurated, none)).toContain('create-rule');
      expect(skillsForProfile('custom', uncurated, none)).not.toContain('create-rule');
    });

    it('never surfaces a guardrails pack as a rule, agent, or skill', () => {
      const offered = [
        ...resolveRuleCollections(uncurated),
        ...resolveAgents(uncurated),
        ...resolveSkills(uncurated),
      ];
      expect(offered.map((p) => p.packageName)).not.toContain('bluetemberg-guardrails-git');
    });

    it('list after the curated overlays', () => {
      const catalog = catalogWith([
        ...uncurated.packs,
        {
          name: 'bluetemberg-rules-git',
          version: '0.1.0',
          description: '',
          kind: 'rules',
          universal: true,
          profiles: [],
          rules: ['git-workflow'],
          preview: '',
        },
      ]);
      expect(resolveRuleCollections(catalog).map((c) => c.id)).toEqual(['git', 'tailwind']);
    });
  });

  describe('stack-specific packs', () => {
    const catalog = catalogWith([
      {
        name: 'bluetemberg-rules-payload',
        version: '0.1.0',
        description: 'Payload CMS rules for Bluetemberg — collection structure.',
        kind: 'rules',
        universal: false,
        profiles: ['backend', 'fullstack'],
        stacks: ['payload'],
        rules: ['payload-collection-structure'],
        preview: '',
      },
      {
        name: 'bluetemberg-skills-react-patterns',
        version: '0.1.0',
        description: '',
        kind: 'skills',
        universal: false,
        profiles: ['frontend'],
        stacks: ['react'],
        skills: ['react-patterns'],
        preview: '',
      },
      {
        name: 'bluetemberg-rules-git',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: true,
        profiles: [],
        rules: ['git-workflow'],
        preview: '',
      },
    ]);

    it('carry the catalog stacks onto the resolved preset', () => {
      expect(resolveRuleCollections(catalog).find((c) => c.id === 'payload')?.stacks).toEqual(['payload']);
      expect(resolveRuleCollections(catalog).find((c) => c.id === 'git')?.stacks).toBeUndefined();
    });

    it('are preselected only when one of their stacks is in the project', () => {
      expect(defaultRuleCollections('backend', catalog, new Set())).toEqual(['git']);
      expect(defaultRuleCollections('backend', catalog, new Set(['payload']))).toEqual(['git', 'payload']);
      expect(skillsForProfile('frontend', catalog, new Set(['nextjs']))).not.toContain('react-patterns');
      expect(skillsForProfile('frontend', catalog, new Set(['react']))).toContain('react-patterns');
    });

    it('are still offered in the wizard when not preselected', () => {
      expect(resolveRuleCollections(catalog).map((c) => c.id)).toContain('payload');
    });
  });
});
