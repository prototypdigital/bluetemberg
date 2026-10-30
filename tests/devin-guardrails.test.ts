import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from '../src/sync/index.js';
import { uninstall } from '../src/uninstall/index.js';
import type { BlueprintConfig } from '../src/types.js';

const CONFIG: BlueprintConfig = { platforms: ['devin'], source: 'llm', targets: {} };

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

type DevinHooks = Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;

describe('guardrails for Devin Desktop', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-devin-guardrails-'));
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
    return join(root, '.devin', 'hooks.v1.json');
  }

  function readHooks(): DevinHooks {
    return JSON.parse(readFileSync(hooksPath(), 'utf8')) as DevinHooks;
  }

  function writeHooks(hooks: unknown): void {
    mkdirSync(join(root, '.devin'), { recursive: true });
    writeFileSync(hooksPath(), JSON.stringify(hooks));
  }

  async function generatedCommand(): Promise<string> {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    return readHooks().PreToolUse?.[0]?.hooks[0]?.command ?? '';
  }

  /** Runs a generated command the way Devin does: through a shell, the documented payload on stdin. */
  function exec(command: string, payload: string, env?: NodeJS.ProcessEnv) {
    return spawnSync('sh', ['-c', command], { input: payload, encoding: 'utf8', env });
  }

  function execPreToolUse(command: string, toolInput: Record<string, unknown>, env?: NodeJS.ProcessEnv) {
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'exec',
      tool_input: toolInput,
      session_id: 'session',
      prompt_id: 'prompt',
    });
    return exec(command, payload, env);
  }

  it('compiles a Bash guardrail to a PreToolUse group on exec', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const hooks = readHooks();
    expect(Object.keys(hooks)).toEqual(['PreToolUse']);
    expect(hooks.PreToolUse).toEqual([
      { matcher: '^exec$', hooks: [{ type: 'command', command: expect.stringMatching(/^bash -c /) }] },
    ]);
  });

  it('blocks a violating exec call with exit 2 and the message on stderr', async () => {
    const command = await generatedCommand();

    const result = execPreToolUse(command, { command: 'git push --force origin main', shell_id: 'main' });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Force-push is blocked');
  });

  it('allows a clean exec call with exit 0 and no output, so it neither blocks nor approves', async () => {
    const command = await generatedCommand();

    const result = execPreToolUse(command, { command: 'git push origin feat/x', shell_id: 'main' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('blocks when jq is missing instead of reading an empty field', async () => {
    const command = await generatedCommand();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const tool of ['sh', 'bash']) symlinkSync(join('/bin', tool), join(bin, tool));

    const result = execPreToolUse(command, { command: 'git push origin feat/x' }, { PATH: bin });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('is jq installed?');
  });

  it('blocks a payload that is not JSON', async () => {
    const command = await generatedCommand();

    const result = exec(command, 'not json');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read field');
  });

  it('leaves a PostToolUse guardrail to Claude Code', async () => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nhook_type: PostToolUse'),
    );

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('skips a trigger with no Devin equivalent instead of writing an empty file', async () => {
    writeGuardrail('branch-names', BRANCH_NAMES);

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('adds guardrail groups ahead of hand-written ones and keeps them as written', async () => {
    const mine = { matcher: 'edit', hooks: [{ type: 'command', command: './mine.sh', timeout: 5 }] };
    const stop = [{ matcher: '', hooks: [{ type: 'command', command: './s.sh' }] }];
    writeHooks({ Stop: stop, PreToolUse: [mine] });
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: CONFIG, silent: true });
    await sync(root, { config: CONFIG, silent: true });

    const hooks = readHooks();
    expect(Object.keys(hooks)).toEqual(['Stop', 'PreToolUse']);
    expect(hooks.Stop).toEqual(stop);
    expect(hooks.PreToolUse?.map((g) => g.matcher)).toEqual(['^exec$', 'edit']);
    expect(hooks.PreToolUse?.[1]).toEqual(mine);
  });

  it('does not touch a hand-written file that is not a valid hooks object', async () => {
    mkdirSync(join(root, '.devin'), { recursive: true });
    writeFileSync(hooksPath(), '{ not json');
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([expect.stringContaining('hooks.v1.json')]);
    expect(readFileSync(hooksPath(), 'utf8')).toBe('{ not json');
  });

  it('leaves a hand-written file alone when there are no guardrails', async () => {
    writeHooks({ PreToolUse: [{ matcher: 'exec', hooks: [{ type: 'command', command: './mine.sh' }] }] });
    const before = readFileSync(hooksPath(), 'utf8');

    await sync(root, { config: CONFIG, silent: true });

    expect(readFileSync(hooksPath(), 'utf8')).toBe(before);
  });

  it('removes its own commands once the guardrail is gone and keeps hand-written ones', async () => {
    const generated = await generatedCommand();
    const mine = { type: 'command', command: './mine.sh' };
    writeHooks({
      PreToolUse: [
        { matcher: '^exec$', hooks: [{ type: 'command', command: generated }] },
        { matcher: 'exec', hooks: [{ type: 'command', command: generated }, mine] },
      ],
    });
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });

    await sync(root, { config: CONFIG, silent: true });

    expect(readHooks()).toEqual({ PreToolUse: [{ matcher: 'exec', hooks: [mine] }] });
  });

  it('deletes the file once the guardrails that were its only content are gone', async () => {
    await generatedCommand();
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(1);
    expect(existsSync(hooksPath())).toBe(true);

    await sync(root, { config: CONFIG, silent: true });
    expect(existsSync(hooksPath())).toBe(false);
  });

  it('uninstall removes a guardrail-only hooks file and keeps a hand-written one', async () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { silent: true, recursive: false });
    expect(existsSync(hooksPath())).toBe(true);

    await uninstall(root);

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('uninstall keeps hand-written groups in the hooks file', async () => {
    const mine = { matcher: 'edit', hooks: [{ type: 'command', command: './mine.sh' }] };
    writeHooks({ PreToolUse: [mine] });
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { silent: true, recursive: false });
    expect(readHooks().PreToolUse).toHaveLength(2);

    await uninstall(root);

    expect(readHooks()).toEqual({ PreToolUse: [mine] });
  });

  it.each([
    ['claude', false],
    ['devin', true],
    ['windsurf', true],
  ])('respects platforms: [%s] on a guardrail', async (platform, written) => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', `trigger: Bash\nplatforms: [${platform}]`),
    );

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(written);
  });

  it('accepts windsurf as the platform id in the config', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: { ...CONFIG, platforms: ['windsurf'] }, silent: true });

    expect(readHooks().PreToolUse).toHaveLength(1);
  });

  it('writes nothing when Devin is not a target', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: { ...CONFIG, platforms: ['claude'] }, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });
});
