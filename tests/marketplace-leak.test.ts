import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';
import type { Catalog } from '../src/catalog/index.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-leak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRule(root: string, name: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(join(root, 'llm', 'rules', `${name}.md`), `---\ndescription: ${name}\n---\n\n# ${name}\n`);
}

function writeCatalog(root: string, packs: Catalog['packs']): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  const catalog: Catalog = { generated: '2026-01-01T00:00:00.000Z', packs };
  writeFileSync(join(root, '.bluetemberg', 'catalog.json'), JSON.stringify(catalog));
}

/**
 * Regression guard for the #164 class of bug: a profile-scoped pack file with no `profiles:`
 * frontmatter must inherit its pack's profiles from the catalog — NOT fall back to `[]` (universal)
 * and leak into every marketplace plugin.
 */
describe('marketplace profile leak closure (catalog-derived)', () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('a profile-scoped pack rule with no frontmatter does not leak into a non-matching plugin', async () => {
    writeRule(root, 'foo-rule'); // backend-only pack, no frontmatter profiles
    writeRule(root, 'uni-rule'); // universal pack

    writeCatalog(root, [
      {
        name: 'bluetemberg-rules-foo',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['backend'],
        rules: ['foo-rule'],
        preview: '',
      },
      {
        name: 'bluetemberg-rules-uni',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: true,
        profiles: [],
        rules: ['uni-rule'],
        preview: '',
      },
    ]);

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      marketplace: { plugins: [{ name: 'frontend-plugin', profiles: ['frontend'] }] },
    };

    await sync(root, { config, silent: true });

    // foo-rule is backend-scoped → must NOT appear in a frontend-only plugin.
    // (Before the catalog-derived map, an id absent from presets fell back to [] = universal and leaked here.)
    expect(existsSync(join(root, 'plugins/frontend-plugin/rules/foo-rule.md'))).toBe(false);
    // uni-rule is universal → included in every plugin.
    expect(existsSync(join(root, 'plugins/frontend-plugin/rules/uni-rule.md'))).toBe(true);
  });

  it('frontmatter profiles still win over the catalog-derived map', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    // catalog says backend, but frontmatter overrides to frontend
    writeFileSync(
      join(root, 'llm', 'rules', 'override-rule.md'),
      `---\ndescription: override\nprofiles:\n  - frontend\n---\n\n# override\n`,
    );
    writeCatalog(root, [
      {
        name: 'bluetemberg-rules-foo',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['backend'],
        rules: ['override-rule'],
        preview: '',
      },
    ]);

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      marketplace: { plugins: [{ name: 'frontend-plugin', profiles: ['frontend'] }] },
    };

    await sync(root, { config, silent: true });

    expect(existsSync(join(root, 'plugins/frontend-plugin/rules/override-rule.md'))).toBe(true);
  });
});
