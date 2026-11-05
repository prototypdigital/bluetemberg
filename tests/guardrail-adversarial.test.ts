import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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
import type { BlueprintConfig } from '../src/types.js';
import {
  ADVERSARIAL_CASES,
  ADVERSARIAL_GUARDRAILS,
  type AdversarialCase,
  type AdversarialGuardrail,
} from './fixtures/guardrail-adversarial.js';

/**
 * Runs the adversarial corpus against the hook every host emitter generates, end to end: the
 * guardrails go through a real `sync`, and each generated command runs the way its host runs it,
 * with the payload on stdin. A guardrail must reach the same verdict on every host.
 */

interface HostCommand {
  command?: string;
  bash?: string;
  hooks?: { command?: string }[];
}

interface Host {
  name: string;
  /** The `tool_name` the host reports for its shell tool. */
  toolName: string;
  /** The shell the host runs the command with. */
  shell: 'sh' | 'bash';
  /** Every generated command in the host's output file. */
  commands: (root: string) => string[];
  /** Guardrails the host does not compile (Codex only sends `command` for its shell tool). */
  skips?: readonly AdversarialGuardrail[];
  /** What a passing call prints on stdout. */
  allowStdout: string;
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/** Commands in a list of hook entries, whether flat (`command`, `bash`) or grouped (`hooks[]`). */
function commandsOf(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return (entries as HostCommand[]).flatMap((entry) => [
    ...(entry.command ? [entry.command] : []),
    ...(entry.bash ? [entry.bash] : []),
    ...(entry.hooks ?? []).flatMap((hook) => (hook.command ? [hook.command] : [])),
  ]);
}

/** Reads `<key>.PreToolUse` (or `preToolUse`) from a parsed hooks file. */
function preToolUse(file: unknown, ...keys: string[]): unknown {
  let node: unknown = file;
  for (const key of keys) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

const HOSTS: readonly Host[] = [
  {
    name: 'claude',
    toolName: 'Bash',
    shell: 'sh',
    commands: (root) =>
      commandsOf(preToolUse(readJson(join(root, '.claude', 'settings.json')), 'hooks', 'PreToolUse')),
    allowStdout: '',
  },
  {
    name: 'cursor',
    toolName: 'Shell',
    shell: 'sh',
    commands: (root) =>
      commandsOf(preToolUse(readJson(join(root, '.cursor', 'hooks.json')), 'hooks', 'preToolUse')),
    allowStdout: '{}\n',
  },
  {
    name: 'copilot',
    toolName: 'Bash',
    shell: 'bash',
    commands: (root) =>
      commandsOf(
        preToolUse(
          readJson(join(root, '.github', 'hooks', 'bluetemberg-guardrails.json')),
          'hooks',
          'PreToolUse',
        ),
      ),
    allowStdout: '',
  },
  {
    name: 'codex',
    toolName: 'Bash',
    shell: 'sh',
    commands: (root) => {
      const path = join(root, '.codex', 'config.toml');
      if (!existsSync(path)) return [];
      return commandsOf(preToolUse(tomlParse(readFileSync(path, 'utf8')), 'hooks', 'PreToolUse'));
    },
    skips: ['nested'],
    allowStdout: '',
  },
  {
    name: 'devin',
    toolName: 'exec',
    shell: 'sh',
    commands: (root) => commandsOf(preToolUse(readJson(join(root, '.devin', 'hooks.v1.json')), 'PreToolUse')),
    allowStdout: '',
  },
];

const CONFIG: BlueprintConfig = {
  platforms: ['claude', 'cursor', 'copilot', 'codex', 'devin'],
  source: 'llm',
  targets: {},
};

/** The generated command for `guardrail`, found by the unique message it carries as an argument. */
function commandFor(root: string, host: Host, guardrail: AdversarialGuardrail): string {
  const marker = `'${ADVERSARIAL_GUARDRAILS[guardrail].message}'`;
  const matches = host.commands(root).filter((command) => command.includes(marker));
  if (matches.length !== 1) {
    throw new Error(`${host.name}: expected one hook for ${guardrail}, found ${matches.length}`);
  }
  return matches[0] ?? '';
}

function stdinFor(host: Host, testCase: AdversarialCase): string {
  if ('raw' in testCase.input) return testCase.input.raw(host.toolName);
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: '/tmp',
    tool_name: host.toolName,
    tool_input: testCase.input.toolInput,
  });
}

function run(host: Host, command: string, input: string, env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync(host.shell, ['-c', command], {
    input,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Asserts a verdict the way each host reads it: exit 2 blocks, exit 0 with the pass output allows. */
function expectVerdict(host: Host, result: SpawnSyncReturns<string>, expected: 'deny' | 'allow'): void {
  const summary = { status: result.status, stdout: result.stdout, stderr: result.stderr.slice(0, 300) };
  if (expected === 'deny') {
    expect(summary.status, JSON.stringify(summary)).toBe(2);
    // A deny must never also print a pass (Cursor's `{}`) or an allow decision.
    expect(result.stdout).not.toBe('{}\n');
    expect(result.stdout).not.toContain('"allow"');
    return;
  }
  expect(summary.status, JSON.stringify(summary)).toBe(0);
  expect(result.stdout).toBe(host.allowStdout);
}

describe('guardrail adversarial corpus', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bt-guardrail-adversarial-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mkdirSync(join(root, 'llm', 'guardrails'), { recursive: true });
    for (const { file, frontmatter } of Object.values(ADVERSARIAL_GUARDRAILS)) {
      writeFileSync(join(root, 'llm', 'guardrails', `${file}.md`), frontmatter);
    }
    const results = await sync(root, { config: CONFIG, silent: true });
    expect(results.errors).toEqual([]);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  describe.each(HOSTS)('$name', (host) => {
    const cases = ADVERSARIAL_CASES.filter((c) => !host.skips?.includes(c.guardrail));

    it.each(cases)('$guardrail: $name -> $expected', (testCase) => {
      const command = commandFor(root, host, testCase.guardrail);

      expectVerdict(host, run(host, command, stdinFor(host, testCase)), testCase.expected);
    });

    it('blocks a benign call when jq is not on PATH', () => {
      const bin = join(root, `bin-${host.name}`);
      mkdirSync(bin, { recursive: true });
      for (const tool of ['sh', 'bash', 'cat']) symlinkSync(join('/bin', tool), join(bin, tool));
      const benign: AdversarialCase = {
        name: 'benign',
        guardrail: 'noPush',
        input: { toolInput: { command: 'git status' } },
        expected: 'deny',
      };

      const result = run(host, commandFor(root, host, 'noPush'), stdinFor(host, benign), { PATH: bin });

      expectVerdict(host, result, 'deny');
      expect(result.stderr).toContain('is jq installed?');
    });

    it('compiles every guardrail the host supports', () => {
      const expected = Object.keys(ADVERSARIAL_GUARDRAILS).length - (host.skips?.length ?? 0);
      expect(host.commands(root)).toHaveLength(expected);
    });
  });
});

describe('scalar fields are read as their JSON text', () => {
  it('reads false as "false", and only a missing or null field as empty', async () => {
    const { buildGuardrailCommand } = await import('../src/sync/guardrails.js');
    const command = buildGuardrailCommand({
      trigger: 'Bash',
      message: 'ONLY_FALSE',
      check: { field: 'flag', matches: '^false$' },
    });
    const run = (toolInput: unknown) =>
      spawnSync('sh', ['-c', command], { input: JSON.stringify({ tool_input: toolInput }) }).status;
    expect(run({ flag: false })).toBe(0);
    expect(run({ flag: 'false' })).toBe(0);
    expect(run({ flag: null })).toBe(2);
    expect(run({})).toBe(2);
    expect(run({ flag: 0 })).toBe(2);
  });
});
