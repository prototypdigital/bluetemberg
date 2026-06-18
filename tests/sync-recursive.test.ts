import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-recursive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bluetemberg.config.json'), JSON.stringify(config, null, 2));
}

function writeRule(dir: string, name: string, frontmatter = ''): void {
  mkdirSync(join(dir, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(dir, 'llm', 'rules', `${name}.md`),
    `---\ndescription: ${name}${frontmatter ? '\n' + frontmatter : ''}\n---\n\n# ${name}\n`,
  );
}

const claudeRule = (dir: string, name: string): string => join(dir, '.claude', 'rules', `${name}.md`);

const R14 = 'stacks:\n  react: ">=14 <15"';
const R15 = 'stacks:\n  react: ">=15 <16"';

describe('recursive sync — monorepo fan-out keyed off discovered configs', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A monorepo: root boundary + two packages pinned to different React majors. */
  function scaffoldMonorepo(): { web: string; legacy: string } {
    writeConfig(root, { platforms: ['claude'], source: 'llm', root: true });
    writeRule(root, 'shared-style'); // stack-agnostic, lives only at the root

    const web = join(root, 'packages', 'web');
    writeConfig(web, { platforms: ['claude'], source: 'llm', stacks: { react: '15.2.0' } });
    writeRule(web, 'effects-r14', R14);
    writeRule(web, 'effects-r15', R15);

    const legacy = join(root, 'packages', 'legacy');
    writeConfig(legacy, { platforms: ['claude'], source: 'llm', stacks: { react: '14.0.3' } });
    writeRule(legacy, 'effects-r14', R14);
    writeRule(legacy, 'effects-r15', R15);

    return { web, legacy };
  }

  it('syncs each configured package against its own detected stacks', async () => {
    const { web, legacy } = scaffoldMonorepo();

    // No `config` arg → the orchestrator discovers configs and fans out.
    const results = await sync(root, { silent: true });

    // web is on React 15 → gets the r15 rule, not r14.
    expect(existsSync(claudeRule(web, 'effects-r15'))).toBe(true);
    expect(existsSync(claudeRule(web, 'effects-r14'))).toBe(false);

    // legacy is on React 14 → the inverse.
    expect(existsSync(claudeRule(legacy, 'effects-r14'))).toBe(true);
    expect(existsSync(claudeRule(legacy, 'effects-r15'))).toBe(false);

    // Root still syncs its own shared rule.
    expect(existsSync(claudeRule(root, 'shared-style'))).toBe(true);

    // Exactly three files: web r15 + legacy r14 + root shared (one rule each, claude only;
    // no agents/skills/guardrails dirs exist, so no other subsystem writes).
    expect(results.synced).toBe(3);
  });

  it('check mode aggregates out-of-sync counts across every package', async () => {
    scaffoldMonorepo(); // never synced → every planned file is out of sync

    const results = await sync(root, { check: true, silent: true });

    // Same three files as the write case, gated per package, summed across the fan-out.
    expect(results.outOfSync).toBe(3);
    expect(results.synced).toBe(0); // check mode writes nothing
  });

  it('with recursive:false, syncs only the invocation directory', async () => {
    const { web } = scaffoldMonorepo();

    await sync(root, { silent: true, recursive: false });

    expect(existsSync(claudeRule(root, 'shared-style'))).toBe(true);
    expect(existsSync(join(web, '.claude'))).toBe(false); // package not descended into
  });

  it('a lone root config syncs as a single package (no fan-out, byte-identical path)', async () => {
    writeConfig(root, { platforms: ['claude'], source: 'llm' });
    writeRule(root, 'a');

    const results = await sync(root, { silent: true });

    expect(existsSync(claudeRule(root, 'a'))).toBe(true);
    expect(results.synced).toBeGreaterThan(0);
  });

  it('skips node_modules and dot-directories when discovering package configs', async () => {
    scaffoldMonorepo();
    // A stray config under node_modules must never be treated as a sync target.
    writeConfig(join(root, 'node_modules', 'some-dep'), {
      platforms: ['claude'],
      source: 'llm',
      stacks: { react: '15.2.0' },
    });
    writeRule(join(root, 'node_modules', 'some-dep'), 'should-not-sync');

    await sync(root, { silent: true });

    expect(existsSync(claudeRule(join(root, 'node_modules', 'some-dep'), 'should-not-sync'))).toBe(false);
  });

  it('fans out to child packages even when the root has no config', async () => {
    // No config at the invocation root — only the children opt in.
    const web = join(root, 'packages', 'web');
    writeConfig(web, { platforms: ['claude'], source: 'llm', stacks: { react: '15.2.0' } });
    writeRule(web, 'effects-r15', R15);
    const legacy = join(root, 'packages', 'legacy');
    writeConfig(legacy, { platforms: ['claude'], source: 'llm', stacks: { react: '14.0.3' } });
    writeRule(legacy, 'effects-r14', R14);

    await sync(root, { silent: true });

    expect(existsSync(claudeRule(web, 'effects-r15'))).toBe(true);
    expect(existsSync(claudeRule(legacy, 'effects-r14'))).toBe(true);
    // The config-less root is not itself a sync target → no root output.
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('respects a nested root:true boundary when fanning out', async () => {
    // Outer boundary declares cursor; the inner sub-monorepo is its own root declaring claude.
    writeConfig(root, { platforms: ['cursor'], source: 'llm', root: true });
    const inner = join(root, 'sub');
    writeConfig(inner, { platforms: ['claude'], source: 'llm', root: true });
    writeRule(inner, 'a');

    await sync(root, { silent: true });

    // inner has root:true → it inherits NOTHING from the outer config (claude only, never cursor).
    expect(existsSync(claudeRule(inner, 'a'))).toBe(true);
    expect(existsSync(join(inner, '.cursor', 'rules', 'a.mdc'))).toBe(false);
  });
});
