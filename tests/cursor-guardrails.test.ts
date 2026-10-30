import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from '../src/sync/index.js';
import type { BlueprintConfig } from '../src/types.js';

const CONFIG: BlueprintConfig = { platforms: ['cursor'], source: 'llm', targets: {} };

const NO_FORCE_PUSH = `---
description: No force push
trigger: Bash
check:
  field: command
  not_matches: 'git push.*--force'
message: 'Force-push is blocked. Push without --force, or ask the user.'
---

# No force push
`;

const BRANCH_NAMES = `---
description: Branch names
trigger: EnterWorktree
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'Use type/description.'
---

# Branch names
`;

interface CursorHooks {
  version: number;
  hooks: Record<string, { command: string; matcher?: string; failClosed?: boolean }[]>;
}

describe('guardrails for Cursor', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-cursor-guardrails-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  function writeGuardrail(name: string, content: string): void {
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    writeFileSync(join(root, 'llm', 'guardrails', `${name}.md`), content);
  }

  function hooksPath(): string {
    return join(root, '.cursor', 'hooks.json');
  }

  function readHooks(): CursorHooks {
    return JSON.parse(readFileSync(hooksPath(), 'utf8')) as CursorHooks;
  }

  /** Runs a generated command the way Cursor does: through a shell, payload on stdin. */
  function run(command: string, toolInput: Record<string, unknown>): number | null {
    const payload = JSON.stringify({
      hook_event_name: 'preToolUse',
      tool_name: 'Shell',
      tool_input: toolInput,
    });
    return spawnSync('sh', ['-c', command], { input: payload, encoding: 'utf8' }).status;
  }

  it('compiles a Bash guardrail to a fail-closed preToolUse entry on Shell', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const entries = readHooks().hooks.preToolUse ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ matcher: '^Shell$', failClosed: true });
  });

  it('the generated command blocks a violating Shell call and allows a clean one', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    const command = readHooks().hooks.preToolUse?.[0]?.command ?? '';

    expect(run(command, { command: 'git push --force origin main' })).toBe(2);
    expect(run(command, { command: 'git push origin feat/x' })).toBe(0);
  });

  it('skips a trigger with no Cursor equivalent instead of writing an empty file', async () => {
    writeGuardrail('branch-names', BRANCH_NAMES);

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('puts guardrail entries before the project llm/hooks.json entries', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    writeFileSync(
      join(root, 'llm', 'hooks.json'),
      JSON.stringify({ hooks: { preToolUse: [{ command: './mine.sh' }] } }),
    );

    await sync(root, { config: CONFIG, silent: true });

    const entries = readHooks().hooks.preToolUse ?? [];
    expect(entries.map((e) => e.command.startsWith('bash -c'))).toEqual([true, false]);
    expect(entries[1]?.command).toBe('./mine.sh');
  });

  it('removes its own entries once the guardrail is gone and keeps hand-written ones', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    const generated = readHooks().hooks.preToolUse?.[0];
    writeFileSync(
      hooksPath(),
      JSON.stringify({ version: 1, hooks: { preToolUse: [generated, { command: './mine.sh' }] } }),
    );
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });

    await sync(root, { config: CONFIG, silent: true });

    expect(readHooks().hooks.preToolUse).toEqual([{ command: './mine.sh' }]);
  });

  it('respects platforms: [claude] on a guardrail', async () => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nplatforms: [claude]'),
    );

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });
});
