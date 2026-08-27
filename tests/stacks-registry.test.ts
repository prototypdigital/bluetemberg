import { describe, it, expect } from 'vitest';
import type { Catalog } from '../src/catalog/index.js';
import {
  buildStackRegistry,
  addCoverageRange,
  registerStack,
  queryCoverage,
} from '../src/stacks/registry.js';
import type { DeclaredRange } from '../src/stacks/declared.js';

function declared(stack: string, range: string, origin: 'local' | 'catalog' = 'catalog'): DeclaredRange {
  return { stack, range, origin, from: `rules/${stack}-${range}` };
}

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

  it('takes the version ranges declared by available guidance', () => {
    const reg = buildStackRegistry(catalogWith([]), undefined, [
      declared('react', '>=18 <19'),
      declared('react', '>=19'),
    ]);
    expect(reg.get('react')?.coveredRanges).toEqual(['>=18 <19', '>=19']);
  });

  it('drops the name-level wildcard for a stack whose ranges are declared', () => {
    // Otherwise `*` satisfies every version and coverage collapses back into a name-level boolean.
    const reg = buildStackRegistry(catalogWith([{ name: 'rules-react', stacks: ['react'] }]), undefined, [
      declared('react', '>=18 <19'),
    ]);
    expect(reg.get('react')?.coveredRanges).toEqual(['>=18 <19']);
    expect(queryCoverage(reg, 'react', '19.0.0')).toMatchObject({
      covered: false,
      reason: 'version-uncovered',
    });
  });

  it('keeps the name-level wildcard for a catalog stack nothing declares a range for', () => {
    const reg = buildStackRegistry(
      catalogWith([
        { name: 'rules-react', stacks: ['react'] },
        { name: 'rules-payload', stacks: ['payload'] },
      ]),
      undefined,
      [declared('react', '>=18 <19')],
    );
    expect(reg.get('payload')?.coveredRanges).toEqual(['*']);
    expect(queryCoverage(reg, 'payload', '2.0.0')).toMatchObject({ covered: true, matchedRange: '*' });
  });

  it('keeps covered ranges in a deterministic most-specific-first order', () => {
    // They are harvested in readdir order (filesystem-dependent) but emitted in `--json`, so the
    // order must not depend on where the declaring files happened to sit.
    const reg = buildStackRegistry(catalogWith([{ name: 'rules-react', stacks: ['react'] }]), undefined, [
      declared('react', '>=19'),
      declared('react', '18.2.0'),
      declared('react', '*'),
      declared('react', '>=18 <19'),
    ]);
    expect(reg.get('react')?.coveredRanges).toEqual(['18.2.0', '>=18 <19', '>=19', '*']);
  });

  it('records where a declared range came from', () => {
    const reg = buildStackRegistry(catalogWith([]), undefined, [declared('react', '>=19', 'local')]);
    expect(queryCoverage(reg, 'react', '19.1.0').origins).toEqual(['local']);
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

  it('reports version-uncovered when the stack is covered but no range satisfies', () => {
    const reg = buildStackRegistry(catalogWith([]));
    addCoverageRange(reg, 'payload', '>=3 <4');
    expect(queryCoverage(reg, 'payload', '2.30.0')).toMatchObject({
      known: true,
      covered: false,
      reason: 'version-uncovered',
    });
  });

  it('reports how precisely a covering range matched', () => {
    const reg = buildStackRegistry(catalogWith([]));
    addCoverageRange(reg, 'react', '>=18 <19');
    addCoverageRange(reg, 'react', '*');
    // 18 has a declared range; 19 falls through to the wildcard — covered, but not version-correct.
    expect(queryCoverage(reg, 'react', '18.3.1')).toMatchObject({
      covered: true,
      precision: 'version',
      matchedRange: '>=18 <19',
    });
    expect(queryCoverage(reg, 'react', '19.0.0')).toMatchObject({
      covered: true,
      precision: 'name-level',
      matchedRange: '*',
    });
  });

  it('reports name-level precision without a version only when every range is a wildcard', () => {
    const wildcardOnly = buildStackRegistry(catalogWith([{ name: 'rules-react', stacks: ['react'] }]));
    expect(queryCoverage(wildcardOnly, 'react').precision).toBe('name-level');

    const withRange = buildStackRegistry(
      catalogWith([{ name: 'rules-react', stacks: ['react'] }]),
      undefined,
      [declared('react', '>=18 <19')],
    );
    expect(queryCoverage(withRange, 'react').precision).toBe('version');
  });

  it('reports no-coverage when nothing targets the stack at all', () => {
    const reg = buildStackRegistry(catalogWith([]));
    registerStack(reg, 'astro', '4.0.0', 'detected');
    // The stack is "known" (detection put it there) but nothing covers it — the reason must come
    // from the covered ranges, not from registry membership.
    expect(queryCoverage(reg, 'astro', '4.0.0')).toMatchObject({
      known: true,
      covered: false,
      reason: 'no-coverage',
    });
    expect(queryCoverage(reg, 'astro')).toMatchObject({ covered: false, reason: 'no-coverage' });
    expect(queryCoverage(reg, 'cobol', '85')).toMatchObject({ known: false, reason: 'no-coverage' });
  });

  it('merges locally registered + detected origins', () => {
    const reg = buildStackRegistry(catalogWith([]));
    registerStack(reg, 'astro', '4.0.0', 'detected');
    const result = queryCoverage(reg, 'astro');
    expect(result.known).toBe(true);
    expect(result.origins).toContain('detected');
  });

  it('a detected-only stack with no covering pack is a gap (known but not covered)', () => {
    const reg = buildStackRegistry(catalogWith([]));
    registerStack(reg, 'astro', '4.0.0', 'detected');
    expect(queryCoverage(reg, 'astro')).toMatchObject({ known: true, covered: false });
  });
});
