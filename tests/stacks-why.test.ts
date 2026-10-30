import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import {
  buildWhyDiff,
  buildWhyReport,
  formatWhyDiff,
  formatWhyReport,
  parseStackOverride,
} from '../src/stacks/why.js';
import { callStacksTool } from '../src/mcp/server.js';
import type { WhyDiffReport, WhyReport } from '../src/stacks/why.js';
import { installFakePack } from './helpers/installed-pack.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-why-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(root: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['claude', 'cursor'], source: 'llm', ...extra }),
  );
}

/** Write a rule with optional extra frontmatter lines (e.g. a `stacks:` block). */
function writeRule(root: string, name: string, frontmatter = '', sourceDir = join(root, 'llm')): void {
  mkdirSync(join(sourceDir, 'rules'), { recursive: true });
  writeFileSync(
    join(sourceDir, 'rules', `${name}.md`),
    `---\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeSkill(root: string, name: string, frontmatter = ''): void {
  mkdirSync(join(root, 'llm', 'skills', name), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

function writeGuardrail(root: string, name: string, body: string): void {
  mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
  writeFileSync(join(root, 'llm', 'guardrails', `${name}.md`), body);
}

function writeCatalog(root: string, packs: unknown[]): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({ generated: '2026-06-15T00:00:00.000Z', packs }),
  );
}

const PAYLOAD_PACK = {
  name: 'bluetemberg-rules-payload',
  version: '0.1.0',
  description: '',
  kind: 'rules',
  universal: false,
  profiles: [],
  stacks: ['payload'],
  rules: ['payload-thing', 'payload-precise'],
  preview: '',
};

function only(report: WhyReport): WhyReport['matches'][number] {
  expect(report.matches).toHaveLength(1);
  return report.matches[0];
}

describe('bluetemberg why <file>', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeCatalog(root, []);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('explains an included rule: frontmatter constraint, detected version, confidence and outputs', () => {
    writeConfig(root, { stacks: { payload: '3.4.1' } });
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');

    const item = only(buildWhyReport(root, 'payload-v3'));

    expect(item).toMatchObject({
      kind: 'rules',
      id: 'payload-v3',
      included: true,
      source: { origin: 'local', label: 'local', path: 'llm/rules/payload-v3.md' },
      constraint: {
        source: 'frontmatter',
        pack: null,
        stacks: [
          {
            stack: 'payload',
            range: '>=3 <4',
            detected: { version: '3.4.1', confidence: 'declared', source: 'config' },
            satisfied: true,
            lowConfidence: false,
          },
        ],
      },
    });
    expect(item.outputs).toEqual(['.cursor/rules/payload-v3.mdc', '.claude/rules/payload-v3.md']);
  });

  it('explains a rule excluded by version with the same reason sync logs', () => {
    writeConfig(root, { stacks: { payload: '2.5.0' } });
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');

    const item = only(buildWhyReport(root, 'payload-v3'));

    expect(item.included).toBe(false);
    expect(item.reason).toBe("payload >=3 <4 (you're on 2.5.0)");
    expect(item.constraint.stacks[0].satisfied).toBe(false);
    expect(item.outputs).toEqual([]);
  });

  it('explains a rule excluded because the stack is absent', () => {
    writeConfig(root);
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');

    const item = only(buildWhyReport(root, 'payload-v3'));

    expect(item.included).toBe(false);
    expect(item.reason).toBe('payload not present');
    expect(item.constraint.stacks[0].detected).toBeNull();
  });

  it('explains a stack-agnostic rule', () => {
    writeConfig(root, { stacks: { payload: '3.4.1' } });
    writeRule(root, 'git-workflow');

    const item = only(buildWhyReport(root, 'git-workflow'));

    expect(item.included).toBe(true);
    expect(item.constraint).toEqual({ source: 'none', pack: null, stacks: [] });
    expect(item.reason).toMatch(/stack-agnostic/);
  });

  it('flags a match that rests on a low-confidence (coerced) detection', () => {
    writeConfig(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { payload: '^3.1.0' } }));
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');

    const item = only(buildWhyReport(root, 'payload-v3'));

    expect(item.included).toBe(true);
    expect(item.constraint.stacks[0]).toMatchObject({
      detected: { version: '3.1.0', confidence: 'coerced', source: 'package.json' },
      lowConfidence: true,
    });
    expect(formatWhyReport(buildWhyReport(root, 'payload-v3')).join('\n')).toMatch(/low confidence/);
  });

  it('distinguishes a catalog pack-level constraint from a frontmatter one in the same pack', () => {
    writeConfig(root, { stacks: { payload: '2.0.0' } });
    writeCatalog(root, [PAYLOAD_PACK]);
    const packDir = installFakePack(root, 'bluetemberg-rules-payload', '0.1.0');
    writeRule(root, 'payload-thing', '', packDir);
    writeRule(root, 'payload-precise', 'stacks:\n  payload: ">=3"', packDir);

    const pack = only(buildWhyReport(root, 'payload-thing'));
    expect(pack).toMatchObject({
      included: true,
      source: { origin: 'pack', label: 'bluetemberg-rules-payload@0.1.0' },
      constraint: { source: 'catalog', pack: 'bluetemberg-rules-payload' },
    });
    expect(pack.constraint.stacks[0]).toMatchObject({ stack: 'payload', range: '*', satisfied: true });

    const precise = only(buildWhyReport(root, 'payload-precise'));
    expect(precise).toMatchObject({
      included: false,
      constraint: { source: 'frontmatter', pack: 'bluetemberg-rules-payload' },
    });
  });

  describe('<file> forms', () => {
    beforeEach(() => {
      writeConfig(root, { stacks: { payload: '3.4.1' } });
      writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');
      writeSkill(root, 'payload-migrate', 'stacks:\n  payload: "^4"');
    });

    it('resolves a source path (relative, ./-prefixed, or absolute)', () => {
      for (const query of [
        'llm/rules/payload-v3.md',
        './llm/rules/payload-v3.md',
        join(root, 'llm/rules/payload-v3.md'),
      ]) {
        const report = buildWhyReport(root, query);
        expect(report.matchedAs).toBe('source');
        expect(only(report).id).toBe('payload-v3');
      }
    });

    it('resolves a skill by its SKILL.md or its directory', () => {
      for (const query of ['llm/skills/payload-migrate/SKILL.md', 'llm/skills/payload-migrate/']) {
        const report = buildWhyReport(root, query);
        expect(report.matchedAs).toBe('source');
        expect(only(report)).toMatchObject({ kind: 'skills', included: false });
      }
    });

    it('resolves a generated output path and names its platform, even for an excluded item', () => {
      const rule = buildWhyReport(root, '.cursor/rules/payload-v3.mdc');
      expect(rule.matchedAs).toBe('output');
      expect(rule.platforms).toEqual(['cursor']);
      expect(only(rule).included).toBe(true);

      const skill = buildWhyReport(root, '.claude/skills/payload-migrate');
      expect(skill.matchedAs).toBe('output');
      expect(skill.platforms).toEqual(['claude']);
      expect(only(skill).included).toBe(false);
    });

    it('resolves a bare or kind-qualified id', () => {
      for (const query of ['payload-v3', 'payload-v3.md', 'rules/payload-v3']) {
        const report = buildWhyReport(root, query);
        expect(report.matchedAs).toBe('id');
        expect(only(report).kind).toBe('rules');
      }
    });

    it('returns every kind sharing a bare id, and only one kind when qualified', () => {
      writeRule(root, 'payload-migrate');
      expect(buildWhyReport(root, 'payload-migrate').matches.map((m) => m.kind)).toEqual(['rules', 'skills']);
      expect(buildWhyReport(root, 'skills/payload-migrate').matches.map((m) => m.kind)).toEqual(['skills']);
    });

    it('reports no match (and says what was tried) for an unknown file', () => {
      const report = buildWhyReport(root, 'nope');
      expect(report.matchedAs).toBeNull();
      expect(report.matches).toEqual([]);
      expect(formatWhyReport(report).join('\n')).toMatch(/tried source path, generated path, and id/);
    });
  });

  it('explains a shadowed pack copy by pointing at the local copy that wins', () => {
    writeConfig(root);
    const packDir = installFakePack(root, 'some-pack', '1.2.0');
    writeRule(root, 'naming', '', packDir);
    writeRule(root, 'naming');

    const report = buildWhyReport(root, '.bluetemberg/packs/some-pack/1.2.0/llm/rules/naming.md');

    expect(report.matchedAs).toBe('source');
    expect(report.note).toMatch(/shadowed: sync uses the local copy/);
    const item = only(report);
    expect(item.source.label).toBe('local');
    expect(item.shadowed).toEqual([
      { label: 'some-pack@1.2.0', path: '.bluetemberg/packs/some-pack/1.2.0/llm/rules/naming.md' },
    ]);
  });

  it('explains a guardrail rejected by sync before gating, and a version-gated one', () => {
    writeConfig(root, { stacks: { payload: '3.0.0' } });
    writeGuardrail(root, 'broken', '---\ndescription: broken\n---\n# broken\n');
    writeGuardrail(
      root,
      'payload-only',
      `---\ndescription: p\ntrigger: Bash\ncheck:\n  field: command\n  matches: 'rm'\nmessage: 'no'\nstacks:\n  payload: ">=4"\n---\n# p\n`,
    );

    const broken = only(buildWhyReport(root, 'broken'));
    expect(broken).toMatchObject({ kind: 'guardrails', included: false });
    expect(broken.invalid).toMatch(/invalid frontmatter/);

    const gated = only(buildWhyReport(root, 'llm/guardrails/payload-only.md'));
    expect(gated).toMatchObject({ included: false, invalid: null, reason: "payload >=4 (you're on 3.0.0)" });
  });

  it('surfaces an invalid stack range the way sync warns about it', () => {
    writeConfig(root, { stacks: { payload: '3.0.0' } });
    writeRule(root, 'typo', 'stacks:\n  payload: "three"');

    expect(only(buildWhyReport(root, 'typo')).invalidRanges).toEqual(['payload: "three"']);
  });

  it('agrees with sync on every item it reports as included', async () => {
    writeConfig(root, { stacks: { payload: '3.4.1' } });
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'payload-v4', 'stacks:\n  payload: ">=4"');
    writeRule(root, 'nextjs-only', 'stacks:\n  nextjs: ">=15"');
    writeRule(root, 'git-workflow');
    writeSkill(root, 'payload-migrate', 'stacks:\n  payload: "^4"');
    writeSkill(root, 'review');

    await sync(root, { silent: true });

    for (const id of [
      'payload-v3',
      'payload-v4',
      'nextjs-only',
      'git-workflow',
      'payload-migrate',
      'review',
    ]) {
      const item = only(buildWhyReport(root, id));
      const primary = item.kind === 'skills' ? `.claude/skills/${id}/SKILL.md` : `.claude/rules/${id}.md`;
      expect(existsSync(join(root, primary)), id).toBe(item.included);
      for (const out of item.outputs) expect(existsSync(join(root, out)), out).toBe(true);
    }
  });
});

describe('bluetemberg why --diff <stack@version>', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeCatalog(root, []);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function upgradeFixture(): void {
    writeConfig(root, { stacks: { payload: '3.4.1' } });
    writeRule(root, 'payload-v3', 'stacks:\n  payload: ">=3 <4"');
    writeRule(root, 'payload-v4', 'stacks:\n  payload: ">=4"');
    writeRule(root, 'git-workflow');
    writeSkill(root, 'payload-migrate', 'stacks:\n  payload: "^4"');
  }

  it('lists what an upgrade adds and removes, without writing anything', () => {
    upgradeFixture();

    const report = buildWhyDiff(root, [parseStackOverride('payload@4')]);

    expect(report.overrides).toEqual([{ stack: 'payload', from: '3.4.1', to: '4.0.0' }]);
    expect(report.added.map((e) => `${e.kind}/${e.id}`)).toEqual([
      'rules/payload-v4',
      'skills/payload-migrate',
    ]);
    expect(report.removed).toEqual([
      {
        kind: 'rules',
        id: 'payload-v3',
        source: 'local',
        before: 'included',
        after: "payload >=3 <4 (you're on 4.0.0)",
      },
    ]);
    expect(report.unchanged).toEqual({ included: 1, excluded: 0 });
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('reports no change when the hypothetical version keeps the same set', () => {
    upgradeFixture();

    const report: WhyDiffReport = buildWhyDiff(root, [parseStackOverride('payload@3.9.0')]);

    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(formatWhyDiff(report).join('\n')).toMatch(/no change to the resolved set/);
  });

  it('treats a stack that is not detected today as newly present', () => {
    writeConfig(root);
    writeRule(root, 'next-rsc', 'stacks:\n  nextjs: ">=15"');

    const report = buildWhyDiff(root, [parseStackOverride('nextjs@15.1')]);

    expect(report.overrides).toEqual([{ stack: 'nextjs', from: null, to: '15.1.0' }]);
    expect(report.added).toMatchObject([{ id: 'next-rsc', before: 'nextjs not present' }]);
  });

  it('applies several overrides at once', () => {
    writeConfig(root, { stacks: { payload: '3.0.0', nextjs: '14.0.0' } });
    writeRule(root, 'both', 'stacks:\n  payload: ">=4"\n  nextjs: ">=15"');

    const one = buildWhyDiff(root, [parseStackOverride('payload@4')]);
    const both = buildWhyDiff(root, [parseStackOverride('payload@4'), parseStackOverride('nextjs@15')]);

    expect(one.added).toEqual([]);
    expect(both.added.map((e) => e.id)).toEqual(['both']);
  });

  it('rejects a malformed stack@version spec', () => {
    expect(() => parseStackOverride('payload')).toThrow(/expected <stack>@<version>/);
    expect(() => parseStackOverride('@4')).toThrow(/expected <stack>@<version>/);
    expect(() => parseStackOverride('payload@latest')).toThrow(/not a version/);
    expect(parseStackOverride('@payloadcms/next@3.2.1')).toEqual({
      stack: '@payloadcms/next',
      version: '3.2.1',
    });
  });
});

describe('bluetemberg_why MCP tool', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
    writeCatalog(root, []);
    writeConfig(root, { stacks: { payload: '3.4.1' } });
    writeRule(root, 'payload-v4', 'stacks:\n  payload: ">=4"');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('explains a file, or diffs when given `diff`', async () => {
    const why = (await callStacksTool(root, 'bluetemberg_why', { file: 'payload-v4' })) as WhyReport;
    expect(why.matches[0].included).toBe(false);

    const diff = (await callStacksTool(root, 'bluetemberg_why', { diff: ['payload@4'] })) as WhyDiffReport;
    expect(diff.added.map((e) => e.id)).toEqual(['payload-v4']);
  });

  it('requires a file or a diff', async () => {
    await expect(callStacksTool(root, 'bluetemberg_why', {})).rejects.toThrow(/requires a non-empty "file"/);
  });
});
