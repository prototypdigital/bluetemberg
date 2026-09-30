import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';
import { installFakePack } from './helpers/installed-pack.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-sync-stacks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a rule with optional extra frontmatter lines (e.g. a `stacks:` block). */
function writeRule(root: string, name: string, frontmatter = '', sourceDir = join(root, 'llm')): void {
  mkdirSync(join(sourceDir, 'rules'), { recursive: true });
  writeFileSync(
    join(sourceDir, 'rules', `${name}.md`),
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
    const packDir = installFakePack(root, 'bluetemberg-rules-payload');
    writeRule(root, 'payload-thing', '', packDir); // no frontmatter stacks → inherits catalog pack-level {payload:'*'}

    // Project without Payload → excluded.
    await sync(root, { config: configWithStacks(), silent: true });
    expect(existsSync(join(root, RULE_OUT('payload-thing')))).toBe(false);

    // Same rule on a Payload project → applied (any version satisfies the wildcard).
    rmSync(join(root, '.claude'), { recursive: true, force: true });
    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });
    expect(existsSync(join(root, RULE_OUT('payload-thing')))).toBe(true);
  });

  it("never withholds a project's own rule because a catalog pack claims the same id (#249)", async () => {
    writeCatalog(root, [
      {
        name: 'bluetemberg-rules-react',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: [],
        stacks: ['react'],
        rules: ['naming'],
        preview: '',
      },
    ]);
    writeRule(root, 'naming'); // the project's own conventions — not the react pack's file

    const results = await sync(root, { config: configWithStacks(), silent: true });

    expect(existsSync(join(root, RULE_OUT('naming')))).toBe(true);
    expect(results.warnings).toEqual([]);
  });

  it("does not gate one pack's file by another pack's stacks when their ids collide", async () => {
    writeCatalog(root, [
      {
        name: 'bluetemberg-rules-react',
        version: '0.1.0',
        description: '',
        kind: 'rules',
        universal: false,
        profiles: [],
        stacks: ['react'],
        rules: ['naming'],
        preview: '',
      },
    ]);
    writeRule(root, 'naming', '', installFakePack(root, 'bluetemberg-rules-general'));

    await sync(root, { config: configWithStacks(), silent: true });

    expect(existsSync(join(root, RULE_OUT('naming')))).toBe(true);
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

  it('warns about a low-confidence stack once per sync, not once per gated file', async () => {
    for (const name of ['payload-a', 'payload-b', 'payload-c'])
      writeRule(root, name, 'stacks:\n  payload: ">=3 <4"');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { payload: '^3.4.0' } }),
    );

    const results = await sync(root, { config: configWithStacks(), silent: true });

    expect(results.warnings.filter((w) => w.includes('low-confidence'))).toHaveLength(1);
  });

  it('warns when a rule declares a range no version can satisfy', async () => {
    writeRule(root, 'impossible', 'stacks:\n  payload: ">=4 <3"');

    const results = await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    expect(existsSync(join(root, RULE_OUT('impossible')))).toBe(false);
    expect(results.warnings.some((w) => w.includes('impossible') && w.includes('matches no version'))).toBe(
      true,
    );
  });

  it('warns when two non-local sources ship the same rule, but not for a local override', async () => {
    const packA = join(root, 'pack-a');
    const packB = join(root, 'pack-b');
    for (const dir of [packA, packB]) {
      mkdirSync(join(dir, 'rules'), { recursive: true });
      writeFileSync(join(dir, 'rules', 'testing.md'), '---\ndescription: testing\n---\n\n# testing\n');
    }
    const config = { ...configWithStacks(), extends: ['./pack-a', './pack-b'] };

    const shadowed = await sync(root, { config, silent: true });
    expect(
      shadowed.warnings.some((w) => w.includes('rules/testing.md') && w.includes('extends[0] wins')),
    ).toBe(true);

    writeRule(root, 'testing'); // a local copy is the documented override — no warning
    const overridden = await sync(root, { config, silent: true });
    expect(overridden.warnings.some((w) => w.includes('rules/testing.md'))).toBe(false);
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

describe('project sync — audible stack filtering', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Write a guardrail with valid base frontmatter plus optional extra lines (e.g. a `stacks:` block). */
  function writeGuardrail(name: string, extra = ''): void {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'guardrails', `${name}.md`),
      `---\ntrigger: SomeTool\nmessage: blocked\ncheck:\n  field: name\n  not_empty: true${extra ? '\n' + extra : ''}\n---\n\n# ${name}\n`,
    );
  }

  /** Capture console.log lines for a non-silent sync. */
  function captureLogs(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '));
    });
    return { lines, restore: () => spy.mockRestore() };
  }

  it('warns (never silently drops) when a rule declares an invalid stack range', async () => {
    // "15..16" is a realistic typo (Ruby-style range) that semver rejects.
    writeRule(root, 'typo-range', 'stacks:\n  react: "15..16"');

    const results = await sync(root, { config: configWithStacks({ react: '15.2.0' }), silent: true });

    expect(results.warnings.some((w) => w.includes('invalid stack range') && w.includes('react'))).toBe(true);
    // The dropped range widens the rule to agnostic, so it still applies — the warning is the signal.
    expect(existsSync(join(root, RULE_OUT('typo-range')))).toBe(true);
  });

  it('warns when a rule declares a non-string stack range value', async () => {
    // A YAML scalar (`react: 15` → number) silently vanishes from the constraint too — surface it.
    writeRule(root, 'bad-type', 'stacks:\n  react: 15');

    const results = await sync(root, { config: configWithStacks({ react: '15.2.0' }), silent: true });

    expect(
      results.warnings.some((w) => w.includes('invalid stack range') && w.includes('not a string')),
    ).toBe(true);
    expect(existsSync(join(root, RULE_OUT('bad-type')))).toBe(true);
  });

  it('warns when a guardrail declares an invalid stack range', async () => {
    writeGuardrail('typo-guardrail', 'stacks:\n  payload: "15..16"');

    const results = await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    expect(results.warnings.some((w) => w.includes('invalid stack range') && w.includes('payload'))).toBe(
      true,
    );
  });

  it('logs the detected stacks so the user can see what the gate matched against', async () => {
    writeRule(root, 'a');
    const { lines, restore } = captureLogs();
    try {
      await sync(root, { config: configWithStacks({ react: '15.2.0' }) });
    } finally {
      restore();
    }
    expect(lines.some((l) => l.includes('Detected stacks:') && l.includes('react@15.2.0'))).toBe(true);
  });

  it('lists per-file guardrail exclusion reasons (parity with rules)', async () => {
    writeGuardrail('payload-only', 'stacks:\n  payload: ">=3 <4"');
    const { lines, restore } = captureLogs();
    try {
      await sync(root, { config: configWithStacks({ payload: '2.0.0' }) });
    } finally {
      restore();
    }
    expect(lines.some((l) => l.includes('Guardrails:') && l.includes('source files'))).toBe(true);
    expect(lines.some((l) => l.includes('applied') && l.includes('filtered out by version'))).toBe(true);
    expect(lines.some((l) => l.includes('payload-only') && l.includes("you're on 2.0.0"))).toBe(true);
  });
});

describe('project sync — agent & skill version gating', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeAgent(name: string, frontmatter = ''): void {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'agents', `${name}.md`),
      `---\nname: ${name}\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
    );
  }

  function writeSkill(name: string, frontmatter = ''): void {
    mkdirSync(join(root, 'llm', 'skills', name), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
    );
  }

  const agentOut = (name: string): string => join(root, '.claude', 'agents', `${name}.md`);
  const skillOut = (name: string): string => join(root, '.claude', 'skills', name, 'SKILL.md');

  it('hard-excludes a version-specific agent the project does not match', async () => {
    writeAgent('payload-v3-helper', 'stacks:\n  payload: ">=3 <4"');
    writeAgent('universal-helper'); // stack-agnostic

    await sync(root, { config: configWithStacks({ payload: '2.5.0' }), silent: true });

    expect(existsSync(agentOut('payload-v3-helper'))).toBe(false);
    expect(existsSync(agentOut('universal-helper'))).toBe(true);
  });

  it('applies a version-specific agent when the detected version matches', async () => {
    writeAgent('payload-v3-helper', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    expect(existsSync(agentOut('payload-v3-helper'))).toBe(true);
  });

  it('hard-excludes a version-specific skill the project does not match', async () => {
    writeSkill('payload-v3-skill', 'stacks:\n  payload: ">=3 <4"');
    writeSkill('universal-skill'); // stack-agnostic

    await sync(root, { config: configWithStacks({ payload: '2.5.0' }), silent: true });

    expect(existsSync(skillOut('payload-v3-skill'))).toBe(false);
    expect(existsSync(skillOut('universal-skill'))).toBe(true);
  });

  it('applies a version-specific skill when the detected version matches', async () => {
    writeSkill('payload-v3-skill', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '3.4.1' }), silent: true });

    expect(existsSync(skillOut('payload-v3-skill'))).toBe(true);
  });
});

describe('project sync — version gating reaches Codex', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const codexConfig = (stacks?: Record<string, string>): BlueprintConfig => ({
    platforms: ['codex'],
    source: 'llm',
    targets: {},
    ...(stacks ? { stacks } : {}),
  });

  function writeAgent(name: string, frontmatter = ''): void {
    mkdirSync(join(root, 'llm', 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'agents', `${name}.md`),
      `---\nname: ${name}\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\nYou are ${name}.\n`,
    );
  }

  const agentsMd = (): string => readFileSync(join(root, 'AGENTS.md'), 'utf8');

  it('keeps a rule out of the AGENTS.md block when its range excludes the detected version', async () => {
    writeRule(root, 'react18-only', 'stacks:\n  react: ">=18 <19"');
    writeRule(root, 'always');

    await sync(root, { config: codexConfig({ react: '19.0.0' }), silent: true });

    expect(agentsMd()).toContain('# always');
    expect(agentsMd()).not.toContain('# react18-only');
  });

  it('keeps a rule out of the block when its stack is not present at all', async () => {
    writeRule(root, 'payload-collections', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'always');

    await sync(root, { config: codexConfig(), silent: true });

    expect(agentsMd()).not.toContain('# payload-collections');
    expect(agentsMd()).toContain('# always');
  });

  it('includes a rule in the block when the detected version satisfies its range', async () => {
    writeRule(root, 'react19-only', 'stacks:\n  react: ">=19 <20"');

    await sync(root, { config: codexConfig({ react: '19.0.0' }), silent: true });

    expect(agentsMd()).toContain('# react19-only');
  });

  it('writes no rules block at all when every rule is filtered out', async () => {
    writeRule(root, 'react18-only', 'stacks:\n  react: ">=18 <19"');

    await sync(root, { config: codexConfig({ react: '19.0.0' }), silent: true });

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });

  it('does not write a .codex/agents TOML for an agent the version gate withheld', async () => {
    writeAgent('react18-agent', 'stacks:\n  react: ">=18 <19"');
    writeAgent('general-agent');

    await sync(root, { config: codexConfig({ react: '19.0.0' }), silent: true });

    expect(existsSync(join(root, '.codex', 'agents', 'react18-agent.toml'))).toBe(false);
    expect(existsSync(join(root, '.codex', 'agents', 'general-agent.toml'))).toBe(true);
  });

  it('does not repeat the gate warnings because of Codex', async () => {
    writeRule(root, 'bad-range', 'stacks:\n  react: "not a range"');

    const results = await sync(root, { config: codexConfig({ react: '19.0.0' }), silent: true });

    const badRange = results.warnings.filter((w) => w.includes('rules/bad-range.md'));
    expect(badRange).toHaveLength(1);
  });
});
