import { describe, it, expect } from 'vitest';
import type { Catalog } from '../src/catalog/index.js';
import {
  buildStackRegistry,
  addCoverageRange,
  registerStack,
  queryCoverage,
} from '../src/stacks/registry.js';

function catalogWith(packs: Array<{ name: string; stacks?: string[] }>): Catalog {
  return {
    generated: '2026-06-15T00:00:00Z',
    packs: packs.map((p) => ({
      name: p.name,
      version: '0.1.0',
      description: '',
      profiles: [],
      universal: false,
      kind: 'rules' as const,
      stacks: p.stacks,
      preview: '',
    })),
  };
}

describe('buildStackRegistry', () => {
  it('collects stacks declared by catalog packs with wildcard coverage', () => {
    const reg = buildStackRegistry(catalogWith([{ name: 'rules-payload', stacks: ['payload'] }]));
    const entry = reg.get('payload');
    expect(entry?.origins.has('catalog')).toBe(true);
    expect(entry?.coveredRanges).toEqual(['*']);
  });
  it('ignores stack-agnostic packs', () => {
    const reg = buildStackRegistry(catalogWith([{ name: 'rules-git' }]));
    expect(reg.size).toBe(0);
  });
});

describe('queryCoverage', () => {
  it('reports unknown stacks', () => {
    const reg = buildStackRegistry(catalogWith([]));
    expect(queryCoverage(reg, 'payload')).toMatchObject({ known: false, covered: false });
  });

  it('name-level coverage: a wildcard pack covers any version', () => {
    const reg = buildStackRegistry(catalogWith([{ name: 'rules-payload', stacks: ['payload'] }]));
    expect(queryCoverage(reg, 'payload', '3.4.1')).toMatchObject({ covered: true, matchedRange: '*' });
  });

  it('version-precise coverage picks the most-specific satisfied range', () => {
    const reg = buildStackRegistry(catalogWith([]));
    addCoverageRange(reg, 'payload', '*');
    addCoverageRange(reg, 'payload', '>=3 <4');
    const covered = queryCoverage(reg, 'payload', '3.4.1');
    expect(covered.covered).toBe(true);
    expect(covered.matchedRange).toBe('>=3 <4'); // narrower wins over '*'
  });

  it('reports version-uncovered when no range satisfies', () => {
    const reg = buildStackRegistry(catalogWith([]));
    addCoverageRange(reg, 'payload', '>=3 <4');
    expect(queryCoverage(reg, 'payload', '2.30.0')).toMatchObject({ known: true, covered: false });
  });

  it('merges locally registered + detected origins', () => {
    const reg = buildStackRegistry(catalogWith([]));
    registerStack(reg, 'astro', '4.0.0', 'detected');
    const result = queryCoverage(reg, 'astro');
    expect(result.known).toBe(true);
    expect(result.origins).toContain('detected');
  });
});
