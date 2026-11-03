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

const CONFIG: BlueprintConfig = { platforms: ['copilot'], source: 'llm', targets: {} };

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

const COMMAND_REQUIRED = `---
description: Command required
trigger: Bash
check:
  field: command
  not_empty: true
message: 'A command is required.'
---

# Command required
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

interface CopilotHooks {
  version: number;
  hooks: Record<string, { type: string; bash: string; matcher?: string }[]>;
}

describe('guardrails for GitHub Copilot', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-copilot-guardrails-'));
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
    return join(root, '.github', 'hooks', 'bluetemberg-guardrails.json');
  }

  function readHooks(): CopilotHooks {
    return JSON.parse(readFileSync(hooksPath(), 'utf8')) as CopilotHooks;
  }

  async function generatedCommand(content = NO_FORCE_PUSH): Promise<string> {
    writeGuardrail('guardrail', content);
    await sync(root, { config: CONFIG, silent: true });
    return readHooks().hooks.PreToolUse?.[0]?.bash ?? '';
  }

  /** Runs a generated command the way Copilot does: through bash, payload on stdin. */
  function execRaw(command: string, input: string, env?: NodeJS.ProcessEnv) {
    return spawnSync('bash', ['-c', command], { input, encoding: 'utf8', env });
  }

  /** The VS Code compatible `PreToolUse` payload Copilot sends for its shell tool. */
  function exec(command: string, toolInput: Record<string, unknown>, toolName = 'Bash') {
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      timestamp: '2026-10-30T00:00:00Z',
      cwd: root,
      tool_name: toolName,
      tool_input: toolInput,
    });
    return execRaw(command, payload);
  }

  it('compiles a Bash guardrail to a PreToolUse bash entry matched on Bash', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const { version, hooks } = readHooks();
    expect(version).toBe(1);
    expect(Object.keys(hooks)).toEqual(['PreToolUse']);
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse?.[0]).toMatchObject({ type: 'command', matcher: 'Bash' });
    expect(hooks.PreToolUse?.[0]?.bash.startsWith('bash -c ')).toBe(true);
  });

  it('denies a violating call with exit 2 and the message as permissionDecisionReason', async () => {
    const command = await generatedCommand();

    const block = exec(command, { command: 'git push --force origin main' });

    expect(block.status).toBe(2);
    expect(JSON.parse(block.stdout)).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'Force-push is blocked. Push without --force, or ask the user.',
    });
    expect(block.stderr).toContain('Force-push is blocked');
  });

  it('lets a passing call through with no output, so it makes no permission decision', async () => {
    const command = await generatedCommand();

    const pass = exec(command, { command: 'git push origin feat/x' });

    expect(pass.status).toBe(0);
    expect(pass.stdout).toBe('');
    expect(pass.stdout).not.toContain('allow');
  });

  it('accepts the runtime tool name bash as well as the Claude name', async () => {
    const command = await generatedCommand();

    expect(exec(command, { command: 'git push --force' }, 'bash').status).toBe(2);
  });

  it('ignores other tools, because VS Code Local hooks ignore the matcher', async () => {
    const command = await generatedCommand(COMMAND_REQUIRED);

    const other = exec(command, { filePath: 'README.md' }, 'read_file');

    expect(other.status).toBe(0);
    expect(other.stdout).toBe('');
    expect(exec(command, {}, 'Bash').status).toBe(2);
  });

  it('blocks when jq is missing instead of reading an empty field', async () => {
    const command = await generatedCommand();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const tool of ['bash', 'cat']) symlinkSync(join('/bin', tool), join(bin, tool));
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin x' } });

    const result = execRaw(command, payload, { PATH: bin });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('is jq installed?');
  });

  it('blocks a payload that is not JSON', async () => {
    const command = await generatedCommand();

    const result = execRaw(command, 'not json at all');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read tool_name');
  });

  it.each([
    [
      'the camelCase toolName/toolArgs shape',
      { toolName: 'bash', toolArgs: '{"command":"git push --force"}' },
    ],
    ['an object with no tool_name', { tool_input: { command: 'git push --force' } }],
    ['a null tool_name', { tool_name: null, tool_input: { command: 'git push --force' } }],
    ['a null payload', null],
  ])('blocks %s instead of skipping it as another tool', async (_label, payload) => {
    const command = await generatedCommand();

    const result = execRaw(command, JSON.stringify(payload));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read tool_name');
  });

  it('blocks a payload whose tool_input is not an object', async () => {
    const command = await generatedCommand();

    const result = execRaw(command, JSON.stringify({ tool_name: 'Bash', tool_input: 'git push --force' }));

    expect(result.status).toBe(2);
  });

  it('keeps pack content out of the script: a hostile message is printed, not run', async () => {
    const marker = join(root, 'pwned');
    const command = await generatedCommand(
      NO_FORCE_PUSH.replace(
        "message: 'Force-push is blocked. Push without --force, or ask the user.'",
        `message: '$(touch ${marker}) "quoted" \\\\ done'`,
      ),
    );

    const block = exec(command, { command: 'git push --force' });

    expect(block.status).toBe(2);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(block.stdout).permissionDecisionReason).toBe(`$(touch ${marker}) "quoted" \\\\ done`);
  });

  it('leaves a PostToolUse guardrail to Claude Code: Copilot postToolUse cannot deny', async () => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nhook_type: PostToolUse'),
    );

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('skips a trigger with no Copilot equivalent instead of writing an empty file', async () => {
    writeGuardrail('branch-names', BRANCH_NAMES);

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(join(root, '.github', 'hooks'))).toBe(false);
  });

  it('respects platforms: [claude] on a guardrail', async () => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nplatforms: [claude]'),
    );

    await sync(root, { config: CONFIG, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('writes nothing when copilot is not targeted', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: { ...CONFIG, platforms: ['cursor'] }, silent: true });

    expect(existsSync(hooksPath())).toBe(false);
  });

  it('does not touch other hook files in .github/hooks', async () => {
    const mine = join(root, '.github', 'hooks', 'mine.json');
    mkdirSync(join(root, '.github', 'hooks'), { recursive: true });
    const content = JSON.stringify({ version: 1, hooks: { preToolUse: [{ bash: './mine.sh' }] } });
    writeFileSync(mine, content);
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: CONFIG, silent: true });
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });
    await sync(root, { config: CONFIG, silent: true });

    expect(readFileSync(mine, 'utf8')).toBe(content);
    expect(existsSync(hooksPath())).toBe(false);
  });

  it('keeps hand-written entries in its own file and replaces only generated ones', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    const generated = readHooks().hooks.PreToolUse?.[0];
    const mine = { type: 'command', bash: './mine.sh', matcher: 'Read' };
    writeFileSync(
      hooksPath(),
      JSON.stringify({ version: 1, hooks: { PreToolUse: [generated, mine], sessionStart: [mine] } }),
    );

    await sync(root, { config: CONFIG, silent: true });
    await sync(root, { config: CONFIG, silent: true });

    const { hooks } = readHooks();
    expect(hooks.PreToolUse).toEqual([generated, mine]);
    expect(hooks.sessionStart).toEqual([mine]);

    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });
    await sync(root, { config: CONFIG, silent: true });
    expect(readHooks().hooks).toEqual({ PreToolUse: [mine], sessionStart: [mine] });
  });

  it('does not touch a file that is not valid JSON', async () => {
    mkdirSync(join(root, '.github', 'hooks'), { recursive: true });
    writeFileSync(hooksPath(), '{ not json');
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([expect.stringContaining('bluetemberg-guardrails.json')]);
    expect(readFileSync(hooksPath(), 'utf8')).toBe('{ not json');
  });

  it('deletes the file and its empty directory once the guardrails are gone', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(1);
    expect(existsSync(hooksPath())).toBe(true);

    await sync(root, { config: CONFIG, silent: true });
    expect(existsSync(hooksPath())).toBe(false);
    expect(existsSync(join(root, '.github', 'hooks'))).toBe(false);
  });

  it('is in sync right after a sync', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });

    const check = await sync(root, { config: CONFIG, silent: true, check: true });

    expect(check.outOfSync).toBe(0);
  });

  it('uninstall removes the guardrail hooks file', async () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { silent: true, recursive: false });
    expect(existsSync(hooksPath())).toBe(true);

    await uninstall(root);

    expect(existsSync(hooksPath())).toBe(false);
  });
});
