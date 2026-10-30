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
import { parse as tomlParse } from 'smol-toml';
import { sync } from '../src/sync/index.js';
import { CODEX_WINDOWS_COMMAND } from '../src/sync/guardrails-codex.js';
import { uninstall } from '../src/uninstall/index.js';
import type { BlueprintConfig } from '../src/types.js';

const CONFIG: BlueprintConfig = { platforms: ['codex'], source: 'llm', targets: {} };

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

const HAND_WRITTEN = `model = "gpt-5.3-codex"

[[hooks.PreToolUse]]
matcher = "^apply_patch$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "./mine.sh"
`;

interface CodexConfig {
  model?: string;
  hooks?: {
    PreToolUse?: { matcher: string; hooks: { type: string; command: string; commandWindows?: string }[] }[];
  };
}

describe('guardrails for Codex', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bt-codex-guardrails-'));
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

  function configPath(): string {
    return join(root, '.codex', 'config.toml');
  }

  function readConfig(): CodexConfig {
    return tomlParse(readFileSync(configPath(), 'utf8')) as CodexConfig;
  }

  function guardrailCommand(): string {
    const group = readConfig().hooks?.PreToolUse?.find((g) => g.matcher === '^Bash$');
    return group?.hooks[0]?.command ?? '';
  }

  /** Codex's PreToolUse stdin for its shell tool: `tool_name: "Bash"`, `tool_input: { command: <string> }`. */
  function payload(command: string): string {
    return JSON.stringify({
      session_id: 's-1',
      transcript_path: null,
      cwd: root,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.3-codex',
      permission_mode: 'default',
      turn_id: 't-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: { command },
    });
  }

  /** Runs a generated command the way Codex does: through a shell, payload on stdin. */
  function exec(command: string, input: string, env?: NodeJS.ProcessEnv) {
    return spawnSync('sh', ['-c', command], { input, encoding: 'utf8', env });
  }

  it('compiles a Bash guardrail to a managed [[hooks.PreToolUse]] group on Bash', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const raw = readFileSync(configPath(), 'utf8');
    expect(raw).toContain('# BEGIN BLUETEMBERG MANAGED HOOKS');
    const groups = readConfig().hooks?.PreToolUse ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matcher).toBe('^Bash$');
    expect(groups[0]?.hooks).toEqual([
      { type: 'command', command: expect.stringMatching(/^bash -c /), commandWindows: CODEX_WINDOWS_COMMAND },
    ]);
    expect(raw).not.toContain('async');
  });

  it('blocks a violating call with exit 2 and a reason on stderr', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });

    const result = exec(guardrailCommand(), payload('git push --force origin main'));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    // Codex treats exit 2 with blank stderr as a failed hook and lets the call through.
    expect(result.stderr.trim()).toBe('Force-push is blocked. Push without --force, or ask the user.');
  });

  it('allows a passing call with exit 0 and no output, which Codex reads as continue, not approve', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });

    const result = exec(guardrailCommand(), payload('git push origin feat/x'));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('blocks when jq is missing instead of reading an empty field', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const tool of ['sh', 'bash']) symlinkSync(join('/bin', tool), join(bin, tool));

    const result = exec(guardrailCommand(), payload('git push origin feat/x'), { PATH: bin });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('is jq installed?');
  });

  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['a string tool_input', JSON.stringify({ tool_name: 'Bash', tool_input: 'git push --force' })],
  ])('blocks a payload that is %s', async (_label, input) => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });

    const result = exec(guardrailCommand(), input);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).not.toBe('');
  });

  it('keeps hand-written config, including hand-written hooks, and is idempotent', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(configPath(), HAND_WRITTEN);
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: CONFIG, silent: true });
    const first = readFileSync(configPath(), 'utf8');
    await sync(root, { config: CONFIG, silent: true });

    expect(readFileSync(configPath(), 'utf8')).toBe(first);
    expect(first.startsWith(HAND_WRITTEN.trim())).toBe(true);
    const parsed = readConfig();
    expect(parsed.model).toBe('gpt-5.3-codex');
    expect(parsed.hooks?.PreToolUse?.map((g) => g.matcher)).toEqual(['^apply_patch$', '^Bash$']);
    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(0);
  });

  it('writes the MCP and hooks blocks side by side in one pass', async () => {
    mkdirSync(join(root, 'llm'), { recursive: true });
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers: ['interactive'] }));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    await sync(root, { config: CONFIG, silent: true });

    const parsed = readConfig() as CodexConfig & { mcp_servers?: Record<string, unknown> };
    expect(parsed.mcp_servers?.interactive).toBeDefined();
    expect(parsed.hooks?.PreToolUse).toHaveLength(1);
    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(0);
  });

  it('reports drift in a hand-edited hooks block under --check', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    writeFileSync(configPath(), readFileSync(configPath(), 'utf8').replace('^Bash$', '^Shell$'));

    const check = await sync(root, { config: CONFIG, silent: true, check: true });

    expect(check.outOfSync).toBe(1);
  });

  it('removes its block once the guardrail is gone and keeps hand-written config', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(configPath(), HAND_WRITTEN);
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    rmSync(join(root, 'llm', 'guardrails'), { recursive: true });

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(1);

    await sync(root, { config: CONFIG, silent: true });
    expect(readFileSync(configPath(), 'utf8')).toBe(HAND_WRITTEN);
  });

  it('deletes the file once the guardrails that were its only content are gone', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { config: CONFIG, silent: true });
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nplatforms: [claude]'),
    );

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(1);
    expect(existsSync(configPath())).toBe(true);

    await sync(root, { config: CONFIG, silent: true });
    expect(existsSync(configPath())).toBe(false);
  });

  it('uninstall removes the hooks block and keeps hand-written config', async () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(configPath(), HAND_WRITTEN);
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { silent: true, recursive: false });
    expect(readConfig().hooks?.PreToolUse).toHaveLength(2);

    await uninstall(root);

    expect(readFileSync(configPath(), 'utf8')).toBe(HAND_WRITTEN);
  });

  it('uninstall removes a guardrail-only config file', async () => {
    writeFileSync(join(root, 'bluetemberg.config.json'), JSON.stringify(CONFIG));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);
    await sync(root, { silent: true, recursive: false });
    expect(existsSync(configPath())).toBe(true);

    await uninstall(root);

    expect(existsSync(configPath())).toBe(false);
  });

  it('leaves the file alone and reports it when hand-written hooks cannot be extended', async () => {
    const inline = 'model = "gpt-5.3-codex"\n\n[hooks]\nPreToolUse = []\n';
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(configPath(), inline);
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([expect.stringContaining('would leave invalid TOML')]);
    expect(readFileSync(configPath(), 'utf8')).toBe(inline);
  });

  it('warns when the project config turns hooks off', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(configPath(), '[features]\nhooks = false\n');
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.warnings).toEqual([expect.stringContaining('hooks = false')]);
  });

  it.each([
    ['a trigger with no Codex equivalent', BRANCH_NAMES],
    [
      'a PostToolUse guardrail',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nhook_type: PostToolUse'),
    ],
    ['platforms: [claude]', NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nplatforms: [claude]')],
  ])('writes nothing for %s', async (_label, content) => {
    writeGuardrail('guardrail', content);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    expect(existsSync(configPath())).toBe(false);
  });

  it('compiles a guardrail limited to platforms: [codex]', async () => {
    writeGuardrail(
      'no-force-push',
      NO_FORCE_PUSH.replace('trigger: Bash', 'trigger: Bash\nplatforms: [codex]'),
    );

    await sync(root, { config: { ...CONFIG, platforms: ['codex', 'claude'] }, silent: true });

    expect(readConfig().hooks?.PreToolUse).toHaveLength(1);
    const settings = join(root, '.claude', 'settings.json');
    const claudeHooks = existsSync(settings)
      ? (JSON.parse(readFileSync(settings, 'utf8')) as { hooks?: Record<string, unknown[]> }).hooks
      : undefined;
    expect(claudeHooks?.PreToolUse ?? []).toEqual([]);
  });

  it('rejects a blank message, which Codex would not treat as a block', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH.replace(/message: .*/, "message: '   '"));

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([
      expect.stringContaining('guardrails/no-force-push.md: invalid frontmatter'),
    ]);
    expect(existsSync(configPath())).toBe(false);
  });
  it('gives Windows a fixed command with no pack text, so cmd never parses pack content', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH.replace(/message: .*/, "message: 'Blocked & calc | more'"));

    await sync(root, { config: CONFIG, silent: true });

    const handler = readConfig().hooks?.PreToolUse?.[0]?.hooks[0];
    expect(handler?.command).toContain('Blocked & calc');
    expect(handler?.commandWindows).toBe(CODEX_WINDOWS_COMMAND);
    expect(CODEX_WINDOWS_COMMAND).toMatch(/^[a-z-]+$/);
  });

  it.each([
    ['description', { not_empty: true }],
    ['tool_input.timeout', { not_matches: '^0$' }],
  ])('leaves a Bash check on %s to Claude Code: Codex sends only command', async (field, cond) => {
    const [key, value] = Object.entries(cond)[0] ?? [];
    writeGuardrail(
      'bash-field',
      `---\ntrigger: Bash\ncheck:\n  field: ${field}\n  ${key}: ${JSON.stringify(value)}\nmessage: 'x'\n---\n`,
    );

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    expect(existsSync(configPath())).toBe(false);
  });

  it('accepts tool_input.command as the field', async () => {
    writeGuardrail('no-force-push', NO_FORCE_PUSH.replace('field: command', 'field: tool_input.command'));

    await sync(root, { config: CONFIG, silent: true });

    expect(exec(guardrailCommand(), payload('git push --force')).status).toBe(2);
  });

  it('warns in a linked git worktree, where Codex reads hooks from the main checkout', async () => {
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.warnings).toEqual([expect.stringContaining('linked git worktree')]);
  });

  it('does not warn about worktrees in a regular checkout', async () => {
    mkdirSync(join(root, '.git'));
    writeGuardrail('no-force-push', NO_FORCE_PUSH);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.warnings).toEqual([]);
  });
});
