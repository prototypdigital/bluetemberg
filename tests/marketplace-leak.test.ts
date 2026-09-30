import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';
import type { Catalog } from '../src/catalog/index.js';
import { installFakePack } from './helpers/installed-pack.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-leak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRule(root: string, name: string, sourceDir = join(root, 'llm')): void {
  mkdirSync(join(sourceDir, 'rules'), { recursive: true });
  writeFileSync(join(sourceDir, 'rules', `${name}.md`), `---\ndescription: ${name}\n---\n\n# ${name}\n`);
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
    writeRule(root, 'foo-rule', installFakePack(root, 'bluetemberg-rules-foo')); // backend-only pack, no frontmatter profiles
    writeRule(root, 'uni-rule', installFakePack(root, 'bluetemberg-rules-uni')); // universal pack

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
    // Rules are emitted as `rule-{id}` skills (Claude Code plugins have no native "rules" component).
    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-foo-rule/SKILL.md'))).toBe(false);
    // uni-rule is universal → included in every plugin.
    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-uni-rule/SKILL.md'))).toBe(true);
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

    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-override-rule/SKILL.md'))).toBe(true);
  });

  it("a project's own rule never inherits a catalog pack's profiles through a colliding id (#249)", async () => {
    writeRule(root, 'code-review'); // local house rule, no frontmatter profiles
    writeCatalog(root, [
      {
        name: 'bluetemberg-skills-code-review',
        version: '0.1.0',
        description: '',
        kind: 'skills',
        universal: false,
        profiles: ['backend'],
        skills: ['code-review'],
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

    // Not installed, not the pack's file → universal, not silently filtered as "backend".
    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-code-review/SKILL.md'))).toBe(true);
  });

  it("a pack's profiles do not bleed onto a same-named file from a different pack", async () => {
    writeRule(root, 'naming', installFakePack(root, 'bluetemberg-rules-other'));
    writeCatalog(root, [
      {
        name: 'bluetemberg-rules-backend',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: ['backend'],
        rules: ['naming'],
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

    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-naming/SKILL.md'))).toBe(true);
  });

  it('attributes local-path extends packs (packs-monorepo layout) to their catalog entry', async () => {
    // The packs repo builds the marketplace from `extends: ["./packages/<name>", …]`, each with its
    // own package.json and an `llm/` source dir.
    const packRoot = join(root, 'packages', 'bluetemberg-rules-foo');
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(join(packRoot, 'package.json'), JSON.stringify({ name: 'bluetemberg-rules-foo' }));
    writeRule(root, 'foo-rule', join(packRoot, 'llm'));
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
    ]);

    const config: BlueprintConfig = {
      platforms: ['claude-marketplace'],
      source: 'llm',
      targets: {},
      extends: ['./packages/bluetemberg-rules-foo'],
      marketplace: {
        plugins: [
          { name: 'frontend-plugin', profiles: ['frontend'] },
          { name: 'backend-plugin', profiles: ['backend'] },
        ],
      },
    };

    await sync(root, { config, silent: true });

    expect(existsSync(join(root, 'plugins/frontend-plugin/skills/rule-foo-rule/SKILL.md'))).toBe(false);
    expect(existsSync(join(root, 'plugins/backend-plugin/skills/rule-foo-rule/SKILL.md'))).toBe(true);
  });
});
