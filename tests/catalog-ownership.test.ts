import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPackItemMap, readSourcePackName } from '../src/catalog/ownership.js';
import type { Catalog, CatalogPack } from '../src/catalog/index.js';

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `bt-ownership-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function pack(name: string, rules: string[]): CatalogPack {
  return {
    name,
    version: '0.1.0',
    description: '',
    profiles: [],
    universal: false,
    kind: 'rules',
    rules,
    preview: '',
  };
}

function sourceDirFor(pkgName: string | null, layout: 'llm' | 'flat' = 'llm'): string {
  const base = join(root, Math.random().toString(36).slice(2));
  const source = layout === 'llm' ? join(base, 'llm') : base;
  mkdirSync(join(source, 'rules'), { recursive: true });
  if (pkgName !== null) writeFileSync(join(base, 'package.json'), JSON.stringify({ name: pkgName }));
  return source;
}

describe('readSourcePackName', () => {
  it('reads the owning package from the parent of an llm/ source dir', () => {
    expect(readSourcePackName(sourceDirFor('bluetemberg-rules-a'))).toBe('bluetemberg-rules-a');
  });

  it('reads the owning package from a flat source dir', () => {
    expect(readSourcePackName(sourceDirFor('bluetemberg-rules-a', 'flat'))).toBe('bluetemberg-rules-a');
  });

  it('is undefined when no package.json owns the dir', () => {
    expect(readSourcePackName(sourceDirFor(null))).toBeUndefined();
  });

  it('is undefined for an unparseable package.json', () => {
    const source = sourceDirFor(null);
    writeFileSync(join(source, '..', 'package.json'), '{not json');
    expect(readSourcePackName(source)).toBeUndefined();
  });
});

describe('buildPackItemMap', () => {
  const catalog: Catalog = {
    generated: '2026-06-15T00:00:00.000Z',
    packs: [pack('bluetemberg-rules-a', ['naming']), pack('bluetemberg-rules-b', ['naming', 'other'])],
  };

  it('scopes a value to the pack that owns the file', () => {
    const map = buildPackItemMap(catalog, (p) => p.name);
    expect(map.get(join(sourceDirFor('bluetemberg-rules-a'), 'rules'), 'naming')).toBe('bluetemberg-rules-a');
    expect(map.get(join(sourceDirFor('bluetemberg-rules-b'), 'rules'), 'naming')).toBe('bluetemberg-rules-b');
  });

  it('ignores files whose owner is not in the catalog, or does not list the id', () => {
    const map = buildPackItemMap(catalog, (p) => p.name);
    expect(map.get(join(sourceDirFor('my-project'), 'rules'), 'naming')).toBeUndefined();
    expect(map.get(join(sourceDirFor(null), 'rules'), 'naming')).toBeUndefined();
    expect(map.get(join(sourceDirFor('bluetemberg-rules-a'), 'rules'), 'other')).toBeUndefined();
  });

  it('skips packs whose valueFor returns undefined', () => {
    const map = buildPackItemMap(catalog, (p) => (p.name === 'bluetemberg-rules-a' ? undefined : p.name));
    expect(map.get(join(sourceDirFor('bluetemberg-rules-a'), 'rules'), 'naming')).toBeUndefined();
  });
});
