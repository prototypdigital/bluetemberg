import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-sync-stacks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a rule with optional extra frontmatter lines (e.g. a `stacks:` block). */
function writeRule(root: string, name: string, frontmatter = ''): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'rules', `${name}.md`),
    `---\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeCatalog(root: string, packs: unknown[]): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-06-15T00:00:00.000Z', packs }),
  );
}

const RULE_OUT = (name: string): string => `.claude/rules/${name}.md`;

function configWithStacks(stacks?: Record<string, string>): BlueprintConfig {
  return { platforms: ['claude'], source: 'llm', targets: {}, ...(stacks ? { stacks } : {}) };
}

describe('project sync — version-aware stack gating', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('hard-excludes a rule whose declared range excludes the detected version', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'git-workflow'); // stack-agnostic

    await sync(root, { config: configWithStacks({ payload: '2.5.0' }), silent: true });

    expect(existsSync(join(root, RULE_OUT('payload-collections')))).toBe(false);
    expect(existsSync(join(root, RULE_OUT('git-workflow')))).toBe(true);
  });

  it('applies the same rule when the detected version satisfies the range', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    expect(existsSync(join(root, RULE_OUT('payload-collections')))).toBe(true);
  });

  it('hard-excludes a stack-specific rule when the stack is absent entirely', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');

    // No payload declared and no payload dependency → payload is not detected.
    await sync(root, { config: configWithStacks(), silent: true });

    expect(existsSync(join(root, RULE_OUT('payload-collections')))).toBe(false);
  });

  it('matches a prerelease version against its major (coerce + includePrerelease)', async () => {
    writeRule(root, 'next-rsc', 'stacks:\n  nextjs: ">=15"');

    await sync(root, { config: configWithStacks({ nextjs: '15.0.0-canary.3' }), silent: true });

    expect(existsSync(join(root, RULE_OUT('next-rsc')))).toBe(true);
  });

  it('default behavior is unchanged: no stacks anywhere → every rule applies', async () => {
    writeRule(root, 'a');
    writeRule(root, 'b');

    const results = await sync(root, { config: configWithStacks(), silent: true });

    expect(existsSync(join(root, RULE_OUT('a')))).toBe(true);
    expect(existsSync(join(root, RULE_OUT('b')))).toBe(true);
    expect(results.warnings).toEqual([]);
  });

  it('applies catalog pack-level (name-only) gating to rules without frontmatter ranges', async () => {
    writeCatalog(root, [
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
    ]);
    writeRule(root, 'payload-thing'); // no frontmatter stacks → inherits catalog pack-level {payload:'*'}

    // Project without Payload → excluded.
    await sync(root, { config: configWithStacks(), silent: true });
    expect(existsSync(join(root, RULE_OUT('payload-thing')))).toBe(false);

    // Same rule on a Payload project → applied (any version satisfies the wildcard).
    rmSync(join(root, '.claude'), { recursive: true, force: true });
    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });
    expect(existsSync(join(root, RULE_OUT('payload-thing')))).toBe(true);
  });

  it('warns (never silently drops) when the version came from a low-confidence source', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    // A coerced manifest range (no node_modules / lockfile) is low confidence.
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { payload: '^3.4.0' } }),
    );

    const results = await sync(root, { config: configWithStacks(), silent: true });

    expect(existsSync(join(root, RULE_OUT('payload-collections')))).toBe(true); // still applied
    expect(results.warnings.some((w) => w.includes('low-confidence') && w.includes('payload'))).toBe(true);
  });
});

describe('project sync — guardrail version gating', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeGuardrail(name: string, stacks = ''): void {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'guardrails', `${name}.md`),
      `---\ntrigger: SomeTool\nmessage: blocked\ncheck:\n  field: name\n  not_empty: true${stacks ? '\n' + stacks : ''}\n---\n\n# ${name}\n`,
    );
  }

  it('hard-excludes a guardrail targeting a stack/version the project does not use', async () => {
    writeGuardrail('payload-only', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '2.0.0' }), silent: true });

    const settingsPath = join(root, '.claude', 'settings.json');
    // The only guardrail was version-filtered → no hooks section is written.
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('keeps a guardrail whose version matches', async () => {
    writeGuardrail('payload-only', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    const settingsPath = join(root, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
  });

  it('clears previously-managed hooks (preserving other keys) when all guardrails are filtered', async () => {
    // A prior sync left a managed hooks section alongside an unrelated key.
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify(
        { extraKnownMarketplaces: ['x'], hooks: { PreToolUse: [{ matcher: 'Old' }] } },
        null,
        2,
      ) + '\n',
    );
    writeGuardrail('payload-only', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '2.0.0' }), silent: true });

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks).toBeUndefined(); // stale hook hard-excluded, not left active
    expect(settings.extraKnownMarketplaces).toEqual(['x']); // unrelated keys preserved
  });
});
