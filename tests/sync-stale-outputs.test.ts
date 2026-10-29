import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync, shouldExitWithFailure } from '../src/sync/index.js';
import { withGeneratedBanner } from '../src/sync/banner.js';
import type { BlueprintConfig } from '../src/types.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRule(root: string, name: string): void {
  mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
  writeFileSync(
    join(root, 'llm', 'rules', `${name}.md`),
    `---\ndescription: ${name}\nscope: "**"\n---\n\n# ${name}\n`,
  );
}

/** Runs sync with console output captured; returns the results and the captured lines. */
async function syncCapturing(root: string, options: Parameters<typeof sync>[1]) {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(' '));
  try {
    const results = await sync(root, options);
    return { results, logs };
  } finally {
    console.log = orig;
  }
}

const claude: BlueprintConfig = { platforms: ['claude'], source: 'llm', targets: {} };

describe('sync --check reports stale generated files', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('flags a generated rule whose source was removed, and exits non-zero', async () => {
    writeRule(root, 'keep');
    writeRule(root, 'drop');
    await sync(root, { config: claude, silent: true });
    expect(existsSync(join(root, '.claude', 'rules', 'drop.md'))).toBe(true);

    rmSync(join(root, 'llm', 'rules', 'drop.md'));
    const { results, logs } = await syncCapturing(root, { config: claude, check: true });

    expect(results.stale).toBe(1);
    expect(results.outOfSync).toBe(1);
    expect(shouldExitWithFailure(results, true)).toBe(true);
    expect(logs.some((l) => l.includes('STALE:') && l.includes(join('.claude', 'rules', 'drop.md')))).toBe(
      true,
    );
    expect(
      logs.some((l) => l.includes('1 file(s) out of sync (1 stale). Run: npx bluetemberg sync --prune')),
    ).toBe(true);
  });

  it('flags a generated rule after a stack change filtered it out', async () => {
    mkdirSync(join(root, 'llm', 'rules'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'rules', 'react19-only.md'),
      '---\ndescription: r19\nscope: "**"\nstacks:\n  react: ">=19 <20"\n---\n\n# r19\n',
    );
    const at = (v: string): BlueprintConfig => ({ ...claude, stacks: { react: v } });

    await sync(root, { config: at('19.0.0'), silent: true });
    expect(existsSync(join(root, '.claude', 'rules', 'react19-only.md'))).toBe(true);

    const { results } = await syncCapturing(root, { config: at('18.3.1'), check: true, silent: true });
    expect(results.stale).toBe(1);
  });

  it('ignores a hand-written file in a managed directory (no banner)', async () => {
    writeRule(root, 'keep');
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(root, '.claude', 'rules', 'stray.md'), '# mine\n');

    const { results, logs } = await syncCapturing(root, { config: claude, check: true });

    expect(results.stale).toBe(0);
    expect(logs.some((l) => l.includes('stray.md'))).toBe(false);
  });

  it('does not delete anything in check mode', async () => {
    writeRule(root, 'drop');
    await sync(root, { config: claude, silent: true });
    rmSync(join(root, 'llm', 'rules', 'drop.md'));

    await sync(root, { config: claude, check: true, silent: true });

    expect(existsSync(join(root, '.claude', 'rules', 'drop.md'))).toBe(true);
  });

  it('sees a stale Windsurf workflow under the devin alias', async () => {
    mkdirSync(join(root, '.windsurf', 'workflows'), { recursive: true });
    writeFileSync(
      join(root, '.windsurf', 'workflows', 'old.md'),
      withGeneratedBanner('# old\n', 'commands/old.md'),
    );
    mkdirSync(join(root, 'llm'), { recursive: true });

    const { results } = await syncCapturing(root, {
      config: { platforms: ['windsurf'], source: 'llm', targets: {} },
      check: true,
      silent: true,
    });

    expect(results.stale).toBe(1);
  });
});

describe('sync --prune deletes only what carries the banner', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('removes a stale generated rule but keeps a hand-written neighbour, and says so', async () => {
    writeRule(root, 'keep');
    writeRule(root, 'drop');
    await sync(root, { config: claude, silent: true });
    writeFileSync(join(root, '.claude', 'rules', 'stray.md'), '# mine\n');

    rmSync(join(root, 'llm', 'rules', 'drop.md'));
    const { logs } = await syncCapturing(root, { config: claude, prune: true });

    expect(existsSync(join(root, '.claude', 'rules', 'drop.md'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'rules', 'keep.md'))).toBe(true);
    expect(readFileSync(join(root, '.claude', 'rules', 'stray.md'), 'utf8')).toBe('# mine\n');
    expect(logs.some((l) => l.includes('removed 1 stale generated file'))).toBe(true);
    expect(logs.some((l) => l.endsWith(join('.claude', 'rules', 'stray.md')))).toBe(true);
  });

  it('removes a stale skill and its directory', async () => {
    mkdirSync(join(root, 'llm', 'skills', 'gone'), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'skills', 'gone', 'SKILL.md'),
      '---\nname: gone\ndescription: G\n---\n\n# G\n',
    );
    await sync(root, { config: claude, silent: true });
    expect(existsSync(join(root, '.claude', 'skills', 'gone', 'SKILL.md'))).toBe(true);

    rmSync(join(root, 'llm', 'skills', 'gone'), { recursive: true });
    await sync(root, { config: claude, prune: true, silent: true });

    expect(existsSync(join(root, '.claude', 'skills', 'gone'))).toBe(false);
  });
});

describe('sync --prune and marketplace plugin directories', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const marketplace = (plugins: string[]): BlueprintConfig => ({
    platforms: ['claude', 'claude-marketplace'],
    source: 'llm',
    targets: {},
    marketplace: { plugins: plugins.map((name) => ({ name, displayName: name, description: '' })) },
  });

  function writeSkill(name: string): void {
    mkdirSync(join(root, 'llm', 'skills', name), { recursive: true });
    writeFileSync(
      join(root, 'llm', 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}\n`,
    );
  }

  it('removes a dropped plugin whole, manifest included, when every file in it is generated', async () => {
    writeSkill('patterns');
    await sync(root, { config: marketplace(['web', 'ops']), silent: true });
    expect(existsSync(join(root, 'plugins', 'ops', '.claude-plugin', 'plugin.json'))).toBe(true);

    await sync(root, { config: marketplace(['web']), prune: true, silent: true });

    expect(existsSync(join(root, 'plugins', 'ops'))).toBe(false);
    expect(existsSync(join(root, 'plugins', 'web', 'skills', 'patterns', 'SKILL.md'))).toBe(true);
  });

  it('keeps a dropped plugin manifest when a hand-written file lives in that plugin', async () => {
    writeSkill('patterns');
    await sync(root, { config: marketplace(['web', 'ops']), silent: true });
    mkdirSync(join(root, 'plugins', 'ops', 'skills', 'mine'), { recursive: true });
    writeFileSync(
      join(root, 'plugins', 'ops', 'skills', 'mine', 'SKILL.md'),
      '---\nname: mine\n---\n\n# mine\n',
    );

    await sync(root, { config: marketplace(['web']), prune: true, silent: true });

    expect(existsSync(join(root, 'plugins', 'ops', 'skills', 'patterns', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(root, 'plugins', 'ops', 'skills', 'mine', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'plugins', 'ops', '.claude-plugin', 'plugin.json'))).toBe(true);
  });
});

describe('orphaned guardrail hooks', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const GUARDRAIL = `---
description: Conventional branch names
trigger: EnterWorktree
hook_type: PreToolUse
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'Use a conventional branch name.'
---

# Conventional branch names
`;
  const settingsPath = () => join(root, '.claude', 'settings.json');
  const readSettings = () => JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>;

  function writeGuardrail(): void {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', 'branch-names.md'), GUARDRAIL);
  }

  it('removes the generated hook once its guardrail source is gone', async () => {
    writeGuardrail();
    await sync(root, { config: claude, silent: true });
    expect(readSettings().hooks).toBeDefined();

    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });
    const { logs } = await syncCapturing(root, { config: claude });

    expect(readSettings().hooks).toBeUndefined();
    expect(logs.some((l) => l.includes('removed 1 guardrail hook(s) whose source is gone'))).toBe(true);
  });

  it('keeps hand-written hooks and other settings when removing orphans', async () => {
    writeGuardrail();
    await sync(root, { config: claude, silent: true });
    const settings = readSettings();
    const hooks = settings.hooks as Record<string, unknown[]>;
    hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] });
    hooks.SessionEnd = [{ hooks: [{ type: 'command', command: 'echo bye' }] }];
    settings.extraKnownMarketplaces = { acme: { source: { source: 'github', repo: 'acme/mp' } } };
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');

    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });
    await sync(root, { config: claude, silent: true });

    const after = readSettings();
    expect(after.extraKnownMarketplaces).toEqual(settings.extraKnownMarketplaces);
    expect(after.hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
    });
  });

  it('never touches a settings.json with only hand-written hooks', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, 'llm'), { recursive: true });
    const original =
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, null, 2) +
      '\n';
    writeFileSync(settingsPath(), original);

    const { results } = await syncCapturing(root, { config: claude, silent: true });

    expect(readFileSync(settingsPath(), 'utf8')).toBe(original);
    expect(results.synced).toBe(0);
  });

  it('reports the orphan as drift in check mode and leaves the file alone', async () => {
    writeGuardrail();
    await sync(root, { config: claude, silent: true });
    const before = readFileSync(settingsPath(), 'utf8');

    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });
    const { results, logs } = await syncCapturing(root, { config: claude, check: true });

    expect(results.outOfSync).toBe(1);
    expect(logs.some((l) => l.includes('OUT OF SYNC') && l.includes(join('.claude', 'settings.json')))).toBe(
      true,
    );
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
  });
});
