import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogSync } from '../src/catalog/index.js';

// The optional `stacks` field on a catalog pack is additive: valid string arrays survive, a
// missing field is fine (forward/backward compatible), and a malformed field is rejected.
describe('catalog stacks field validation', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function cacheRootWith(catalog: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'bt-catalog-stacks-'));
    roots.push(root);
    mkdirSync(join(root, '.bluetemberg'), { recursive: true });
    writeFileSync(join(root, '.bluetemberg', 'catalog.json'), JSON.stringify(catalog));
    return root;
  }

  const pack = (extra: Record<string, unknown>) => ({
    generated: '2026-01-01T00:00:00.000Z',
    packs: [
      {
        name: 'bluetemberg-rules-payload',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['backend'],
        preview: '',
        ...extra,
      },
    ],
  });

  it('preserves a valid stacks array', () => {
    const catalog = loadCatalogSync(cacheRootWith(pack({ stacks: ['payload'] })));
    expect(catalog.packs[0].stacks).toEqual(['payload']);
  });

  it('accepts a pack with no stacks field (backward compatible)', () => {
    const catalog = loadCatalogSync(cacheRootWith(pack({})));
    expect(catalog.packs[0].stacks).toBeUndefined();
  });

  it('rejects a malformed stacks field (falls back to the committed snapshot)', () => {
    // assertCatalog throws on a non-string-array `stacks`; loadCatalogSync then uses the snapshot,
    // which never carries the fixture pack name.
    const catalog = loadCatalogSync(cacheRootWith(pack({ stacks: [1, 2, 3] })));
    expect(catalog.packs.find((p) => p.name === 'bluetemberg-rules-payload')).toBeUndefined();
  });
});
