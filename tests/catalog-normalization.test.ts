import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogSync } from '../src/catalog/index.js';

// The packs repo publishes catalog items as `{ name, description }` objects (for its wiki/site),
// while the engine consumes plain string ids. loadCatalogSync must coerce object items to ids so
// downstream consumers (marketplace profile map, preset resolution) never see objects.
describe('catalog item normalization on load', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function cacheRootWith(catalog: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'bt-catalog-'));
    roots.push(root);
    mkdirSync(join(root, '.bluetemberg'), { recursive: true });
    writeFileSync(join(root, '.bluetemberg', 'catalog.json'), JSON.stringify(catalog));
    return root;
  }

  it('coerces object-shaped items ({ name, description }) to string ids', () => {
    const root = cacheRootWith({
      generated: '2026-01-01T00:00:00.000Z',
      packs: [
        {
          name: 'bluetemberg-rules-x',
          version: '0.1.0',
          description: '',
          kind: 'rules',
          universal: false,
          profiles: ['frontend'],
          rules: [
            { name: 'rule-a', description: 'A' },
            { name: 'rule-b', description: 'B' },
          ],
          preview: '',
        },
      ],
    });

    const catalog = loadCatalogSync(root);
    expect(catalog.packs[0].rules).toEqual(['rule-a', 'rule-b']);
  });

  it('leaves already-string items untouched', () => {
    const root = cacheRootWith({
      generated: '2026-01-01T00:00:00.000Z',
      packs: [
        {
          name: 'bluetemberg-agents-y',
          version: '0.1.0',
          description: '',
          kind: 'agents',
          universal: false,
          profiles: ['backend'],
          agents: ['agent-a'],
          preview: '',
        },
      ],
    });

    const catalog = loadCatalogSync(root);
    expect(catalog.packs[0].agents).toEqual(['agent-a']);
  });
});
