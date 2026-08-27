import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

  /**
   * Pins the two `ensurePlannedDir` calls left in syncRules/syncAgents. Every other output
   * directory in the engine is created implicitly by `commitPlannedWrite`; these two are the
   * only ones that must exist when nothing is written into them, so an all-filtered platform
   * reads as "nothing applies here" rather than "never synced". Delete them and this fails.
   */
  it('creates the target dir even when every rule is filtered out by version', async () => {
    writeRule(root, 'payload-only', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '2.5.0' }), silent: true });

    const outDir = join(root, '.claude', 'rules');
    expect(existsSync(outDir)).toBe(true);
    expect(readdirSync(outDir)).toEqual([]);
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

  it('creates the target dir even when every agent is filtered out by version', async () => {
    writeAgent('payload-only', 'stacks:\n  payload: ">=3 <4"');

    await sync(root, { config: configWithStacks({ payload: '2.5.0' }), silent: true });

    const outDir = join(root, '.claude', 'agents');
    expect(existsSync(outDir)).toBe(true);
    expect(readdirSync(outDir)).toEqual([]);
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
