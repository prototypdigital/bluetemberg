import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Catalog } from '../src/catalog/index.js';
import { collectDeclaredRanges } from '../src/stacks/declared.js';
import type { BlueprintConfig } from '../src/types.js';

/**
 * Coverage is only version-aware if the engine reads the real `stacks:` ranges off the guidance
 * that is actually available. These tests pin that harvest across every source dir sync reads
 * (local, `extends`, installed packs) and every content kind that can carry a constraint.
 */

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `bt-declared-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const CONFIG: BlueprintConfig = { platforms: ['claude'], source: 'llm' };

function emptyCatalog(): Catalog {
  return { generated: '2026-06-15T00:00:00.000Z', packs: [] };
}

function catalogWithReactPack(rules: string[]): Catalog {
  return {
    generated: '2026-06-15T00:00:00.000Z',
    packs: [
      {
        name: 'bluetemberg-rules-react',
        version: '1.0.0',
        description: '',
        profiles: [],
        stacks: ['react'],
        universal: false,
        kind: 'rules',
        rules,
        preview: '',
      },
    ],
  };
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function writeRule(dir: string, name: string, stacks?: string): void {
  const frontmatter = stacks
    ? `---\ndescription: r\nstacks:\n  ${stacks}\n---\n`
    : `---\ndescription: r\n---\n`;
  writeFile(join(dir, 'rules', `${name}.md`), `${frontmatter}\nbody\n`);
}

/** Fake an installed pack: manifest + lockfile entry + extracted content in the pack cache. */
function installPack(name: string, version: string): string {
  writeFile(join(root, 'llm', 'packages.json'), JSON.stringify({ packages: { [name]: `^${version}` } }));
  writeFile(
    join(root, 'llm', 'packages-lock.json'),
    JSON.stringify({
      lockfileVersion: 1,
      packages: { [name]: { version, resolved: 'https://example.invalid/x.tgz', integrity: 'sha512-x' } },
    }),
  );
  return join(root, '.bluetemberg', 'packs', name, version, 'llm');
}

describe('collectDeclaredRanges', () => {
  it('harvests a bounded range from the project source dir', () => {
    writeRule(join(root, 'llm'), 'effects-r18', 'react: ">=18 <19"');

    expect(collectDeclaredRanges(root, CONFIG, emptyCatalog())).toEqual([
      { stack: 'react', range: '>=18 <19', origin: 'local', from: 'rules/effects-r18' },
    ]);
  });

  it('harvests every kind that can carry a constraint (rules, agents, skills, guardrails)', () => {
    writeRule(join(root, 'llm'), 'r', 'react: ">=18 <19"');
    writeFile(join(root, 'llm', 'agents', 'a.md'), '---\nname: a\nstacks:\n  nextjs: ">=15 <16"\n---\n');
    writeFile(join(root, 'llm', 'guardrails', 'g.md'), '---\nname: g\nstacks:\n  payload: ">=3 <4"\n---\n');
    writeFile(join(root, 'llm', 'skills', 's', 'SKILL.md'), '---\nname: s\nstacks:\n  astro: ">=4"\n---\n');

    const declared = collectDeclaredRanges(root, CONFIG, emptyCatalog());
    expect(declared.map((d) => `${d.from}=${d.stack}@${d.range}`).sort()).toEqual([
      'agents/a=nextjs@>=15 <16',
      'guardrails/g=payload@>=3 <4',
      'rules/r=react@>=18 <19',
      'skills/s=astro@>=4',
    ]);
  });

  it('reads ranges out of an installed pack, tagged as catalog-origin coverage', () => {
    const packDir = installPack('bluetemberg-rules-react', '1.0.0');
    writeRule(packDir, 'effects-r18', 'react: ">=18 <19"');

    expect(collectDeclaredRanges(root, CONFIG, catalogWithReactPack(['effects-r18']))).toEqual([
      { stack: 'react', range: '>=18 <19', origin: 'catalog', from: 'rules/effects-r18' },
    ]);
  });

  it('reads ranges out of an extends dir', () => {
    const shared = join(root, '..', `bt-shared-${Math.random().toString(36).slice(2)}`);
    try {
      writeRule(join(shared, 'llm'), 'shared-r19', 'react: ">=19"');
      const config: BlueprintConfig = { ...CONFIG, extends: shared };

      expect(collectDeclaredRanges(root, config, emptyCatalog())).toEqual([
        { stack: 'react', range: '>=19', origin: 'catalog', from: 'rules/shared-r19' },
      ]);
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  });

  it('falls back to the catalog pack-level tag (wildcard) for a pack file with no own range', () => {
    const packDir = installPack('bluetemberg-rules-react', '1.0.0');
    writeRule(packDir, 'naming'); // no stacks: frontmatter

    expect(collectDeclaredRanges(root, CONFIG, catalogWithReactPack(['naming']))).toEqual([
      { stack: 'react', range: '*', origin: 'catalog', from: 'rules/naming' },
    ]);
  });

  it('contributes nothing for stack-agnostic local content', () => {
    writeRule(join(root, 'llm'), 'naming'); // no stacks:, no catalog pack claiming the id

    expect(collectDeclaredRanges(root, CONFIG, emptyCatalog())).toEqual([]);
  });

  it('drops an invalid range instead of widening it (never an accidental match)', () => {
    writeRule(join(root, 'llm'), 'typo', 'react: "18..19"');

    expect(collectDeclaredRanges(root, CONFIG, emptyCatalog())).toEqual([]);
  });

  it('a local file overriding a pack file contributes its own range, not the pack version', () => {
    const packDir = installPack('bluetemberg-rules-react', '1.0.0');
    writeRule(packDir, 'effects', 'react: ">=18 <19"');
    writeRule(join(root, 'llm'), 'effects', 'react: ">=19"');

    // mergeSourceFiles gives the local dir priority — coverage reports what would actually apply.
    expect(collectDeclaredRanges(root, CONFIG, catalogWithReactPack(['effects']))).toEqual([
      { stack: 'react', range: '>=19', origin: 'local', from: 'rules/effects' },
    ]);
  });
});
