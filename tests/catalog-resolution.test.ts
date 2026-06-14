import { describe, it, expect } from 'vitest';
import { resolveRuleCollections, resolveAgents, resolveSkills } from '../src/init/presets.js';
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
  });
});
