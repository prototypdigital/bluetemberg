import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-mkt-stacks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Assert a rule was emitted into a plugin AND that its body content was carried through. */
function expectEmitted(root: string, rel: string, name: string): void {
  const path = join(root, rel);
  expect(existsSync(path)).toBe(true);
  expect(readFileSync(path, 'utf8')).toContain(`# ${name}`);
}

/** Write a rule with optional extra frontmatter lines (e.g. a `stacks:` block). */
function writeRule(root: string, name: string, frontmatter = ''): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'rules', `${name}.md`),
    `---\nname: ${name}\ndescription: ${name} description${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

const BASE_CONFIG: BlueprintConfig = {
  platforms: ['claude-marketplace'],
  source: 'llm',
  targets: {},
};

describe('marketplace stack gating (the leak fix)', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('a stack-specific rule does NOT leak into a stack-agnostic role bundle', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'git-workflow'); // stack-agnostic

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: { plugins: [{ name: 'backend', profiles: ['backend'] }] }, // no stacks → agnostic bundle
    };
    await sync(root, { config, silent: true });

    // The role bundle gets the agnostic rule but NOT the Payload rule — this is the bug being fixed.
    expectEmitted(root, 'plugins/backend/rules/git-workflow.md', 'git-workflow');
    expect(existsSync(join(root, 'plugins/backend/rules/payload-collections.md'))).toBe(false);
  });

  it('a stack-specific rule lands in a bundle that opts into its stack', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'git-workflow');

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [
          { name: 'backend', profiles: ['backend'] }, // agnostic
          { name: 'backend-payload', profiles: ['backend'], stacks: ['payload'] }, // opts in
        ],
      },
    };
    await sync(root, { config, silent: true });

    // Stack bundle gets both the agnostic rule and the opted-in Payload rule.
    expectEmitted(root, 'plugins/backend-payload/rules/payload-collections.md', 'payload-collections');
    expectEmitted(root, 'plugins/backend-payload/rules/git-workflow.md', 'git-workflow');
    // Agnostic bundle still excludes the Payload rule.
    expect(existsSync(join(root, 'plugins/backend/rules/payload-collections.md'))).toBe(false);
  });

  it('malformed `stacks` frontmatter falls back to catalog gating (no silent widening)', async () => {
    // A pack rule whose catalog entry declares stacks: ["payload"], but whose frontmatter `stacks`
    // is malformed (a string, not a map). It must stay gated to payload, NOT leak into the agnostic
    // bundle as if it were stack-agnostic.
    mkdirSync(join(root, '.bluetemberg'), { recursive: true });
    writeFileSync(
      join(root, '.bluetemberg', 'catalog.json'),
      JSON.stringify({
        generated: '2026-06-15T00:00:00.000Z',
        packs: [
          {
            name: 'bluetemberg-rules-payload',
            version: '0.1.0',
            description: '',
            kind: 'rules',
            universal: false,
            profiles: [],
            stacks: ['payload'],
            rules: ['payload-thing'],
            preview: '',
          },
        ],
      }),
    );
    writeRule(root, 'payload-thing', 'stacks: "payload"'); // malformed: string, not a map

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: {
        plugins: [
          { name: 'agnostic' }, // no profiles, no stacks
          { name: 'payload-bundle', stacks: ['payload'] },
        ],
      },
    };
    await sync(root, { config, silent: true });

    // Catalog fallback keeps it gated to payload — it must NOT widen into the agnostic bundle.
    expect(existsSync(join(root, 'plugins/agnostic/rules/payload-thing.md'))).toBe(false);
    expectEmitted(root, 'plugins/payload-bundle/rules/payload-thing.md', 'payload-thing');
  });

  it('a stack bundle only accepts the stacks it opts into', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'next-rsc', 'stacks:\n  nextjs: ">=13.4"');

    const config: BlueprintConfig = {
      ...BASE_CONFIG,
      marketplace: { plugins: [{ name: 'nextjs-bundle', stacks: ['nextjs'] }] },
    };
    await sync(root, { config, silent: true });

    expectEmitted(root, 'plugins/nextjs-bundle/rules/next-rsc.md', 'next-rsc');
    expect(existsSync(join(root, 'plugins/nextjs-bundle/rules/payload-collections.md'))).toBe(false);
  });
});
