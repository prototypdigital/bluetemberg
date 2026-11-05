/**
 * Adversarial corpus for compiled guardrail hooks.
 *
 * Guardrails are the one control that still holds when the model is prompt-injected, but only if
 * the generated hook fails closed on hostile tool input. Each case is a hook payload (or raw stdin)
 * aimed at one of the guardrails below, and the verdict the hook must reach on every host.
 *
 * Verdicts:
 * - `deny`: the value violates the check, or the payload cannot be evaluated (fail closed).
 * - `allow`: the value is clearly benign for the check as written.
 *
 * Cases tagged `limit` pin behaviour that is correct for the regex as written but that a reader
 * might expect to be caught (a second command on a new line, a leading space). They document what a
 * guardrail does NOT guarantee; see "Limits" in docs/wiki/Guardrails.md.
 */

/** The guardrails the corpus targets, as pack frontmatter. Every message is a unique marker. */
export const ADVERSARIAL_GUARDRAILS = {
  /** Deny any command that starts with `git push`. */
  noPush: {
    file: 'adv-no-push',
    message: 'ADV_NO_PUSH',
    frontmatter: `---
description: No push
trigger: Bash
check:
  field: command
  not_matches: '^git push'
message: 'ADV_NO_PUSH'
---
`,
  },
  /** Require a non-empty command that starts with `npm `. */
  npmOnly: {
    file: 'adv-npm-only',
    message: 'ADV_NPM_ONLY',
    frontmatter: `---
description: npm only
trigger: Bash
check:
  field: command
  not_empty: true
  matches: '^npm '
message: 'ADV_NPM_ONLY'
---
`,
  },
  /** A nested field path, written against the whole payload. */
  nested: {
    file: 'adv-nested',
    message: 'ADV_NESTED',
    frontmatter: `---
description: Nested path
trigger: Bash
check:
  field: tool_input.opts.target
  not_matches: '^/etc'
message: 'ADV_NESTED'
---
`,
  },
} as const;

export type AdversarialGuardrail = keyof typeof ADVERSARIAL_GUARDRAILS;

/** A full hook payload for a host, built from the host's tool name. */
export type PayloadBuilder = (toolName: string) => string;

export interface AdversarialCase {
  name: string;
  guardrail: AdversarialGuardrail;
  /** `tool_input` as a value (serialized by the harness), or the raw stdin to send. */
  input: { toolInput: unknown } | { raw: PayloadBuilder };
  expected: 'deny' | 'allow';
  /** Correct for the regex as written, but not something the guardrail catches. */
  limit?: true;
}

/** Standard payload with a hand-written `tool_input` JSON text, so escapes reach jq verbatim. */
function rawToolInput(toolInputJson: string): PayloadBuilder {
  return (toolName) =>
    `{"hook_event_name":"PreToolUse","tool_name":${JSON.stringify(toolName)},"tool_input":${toolInputJson}}`;
}

/** Standard payload with extra root-level keys alongside `tool_name`. */
function withRoot(root: Record<string, unknown>): PayloadBuilder {
  return (toolName) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, ...root });
}

const LONG_VALUE_BYTES = 1_500_000;
const LONG_TAIL = 'a'.repeat(LONG_VALUE_BYTES);

const NO_PUSH_CASES: AdversarialCase[] = [
  {
    name: 'plain violation',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git push origin main' } },
    expected: 'deny',
  },
  {
    name: 'plain benign command',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git status' } },
    expected: 'allow',
  },
  {
    name: 'JSON \\u escapes of every matched letter',
    guardrail: 'noPush',
    input: {
      raw: rawToolInput('{"command":"\\u0067\\u0069\\u0074\\u0020\\u0070\\u0075\\u0073\\u0068 origin main"}'),
    },
    expected: 'deny',
  },
  {
    name: 'escaped solidus and upper-case \\u escape',
    guardrail: 'noPush',
    input: { raw: rawToolInput('{"command":"\\u0067it push origin \\/main\\u002F"}') },
    expected: 'deny',
  },
  {
    name: 'duplicate key, violating value last (JSON parsers keep the last)',
    guardrail: 'noPush',
    input: { raw: rawToolInput('{"command":"git status","command":"git push"}') },
    expected: 'deny',
  },
  {
    name: 'fullwidth confusable (not the git binary)',
    guardrail: 'noPush',
    input: { toolInput: { command: '\uFF47\uFF49\uFF54 push' } },
    expected: 'allow',
  },
  {
    name: 'Cyrillic confusable (not the git binary)',
    guardrail: 'noPush',
    input: { toolInput: { command: 'g\u0456t push' } },
    expected: 'allow',
  },
  {
    name: 'trailing NUL',
    guardrail: 'noPush',
    input: { raw: rawToolInput('{"command":"git push\\u0000"}') },
    expected: 'deny',
  },
  {
    name: 'leading NUL',
    guardrail: 'noPush',
    input: { raw: rawToolInput('{"command":"\\u0000git push"}') },
    expected: 'deny',
  },
  {
    name: 'NUL inside the match',
    guardrail: 'noPush',
    input: { raw: rawToolInput('{"command":"git\\u0000 push"}') },
    expected: 'deny',
  },
  {
    name: 'trailing newline',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git push\n' } },
    expected: 'deny',
  },
  {
    name: 'trailing CRLF',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git push\r\n' } },
    expected: 'deny',
  },
  {
    name: 'shell syntax in the value is data, not code',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git push "$(exit 0)" `exit 0`; exit 0' } },
    expected: 'deny',
  },
  {
    name: 'printf format directives in the value',
    guardrail: 'noPush',
    input: { toolInput: { command: 'git push %s%n%99999999d' } },
    expected: 'deny',
  },
  {
    name: 'value over 1 MB that matches',
    guardrail: 'noPush',
    input: { toolInput: { command: `git push ${LONG_TAIL}` } },
    expected: 'deny',
  },
  {
    name: 'value over 1 MB that is benign',
    guardrail: 'noPush',
    input: { toolInput: { command: `echo ${LONG_TAIL}` } },
    expected: 'allow',
  },
  {
    name: 'second command on a new line (^ anchors the whole value only)',
    guardrail: 'noPush',
    input: { toolInput: { command: 'echo ok\ngit push' } },
    expected: 'allow',
    limit: true,
  },
  {
    name: 'leading whitespace (the regex is anchored)',
    guardrail: 'noPush',
    input: { toolInput: { command: ' git push' } },
    expected: 'allow',
    limit: true,
  },
  { name: 'field missing', guardrail: 'noPush', input: { toolInput: {} }, expected: 'allow' },
  { name: 'field null', guardrail: 'noPush', input: { toolInput: { command: null } }, expected: 'allow' },
  { name: 'field number', guardrail: 'noPush', input: { toolInput: { command: 42 } }, expected: 'allow' },
  { name: 'field boolean', guardrail: 'noPush', input: { toolInput: { command: true } }, expected: 'allow' },
  {
    name: 'field array (argv form)',
    guardrail: 'noPush',
    input: { toolInput: { command: ['git', 'push'] } },
    expected: 'deny',
  },
  {
    name: 'field array of one string',
    guardrail: 'noPush',
    input: { toolInput: { command: ['git push'] } },
    expected: 'deny',
  },
  {
    name: 'field object',
    guardrail: 'noPush',
    input: { toolInput: { command: { cmd: 'git push' } } },
    expected: 'deny',
  },
  {
    name: 'field an empty array',
    guardrail: 'noPush',
    input: { toolInput: { command: [] } },
    expected: 'deny',
  },
  {
    name: 'field at the payload root only, not under tool_input',
    guardrail: 'noPush',
    input: { raw: withRoot({ command: 'git push', tool_input: { command: 'git status' } }) },
    expected: 'allow',
  },
  {
    name: 'tool_input missing',
    guardrail: 'noPush',
    input: { raw: withRoot({ command: 'git push' }) },
    expected: 'deny',
  },
  { name: 'tool_input null', guardrail: 'noPush', input: { toolInput: null }, expected: 'deny' },
  { name: 'tool_input a string', guardrail: 'noPush', input: { toolInput: 'git push' }, expected: 'deny' },
  {
    name: 'tool_input an array',
    guardrail: 'noPush',
    input: { toolInput: [{ command: 'git push' }] },
    expected: 'deny',
  },
  {
    name: 'payload root an array',
    guardrail: 'noPush',
    input: { raw: () => '[{"tool_input":{"command":"git push"}}]' },
    expected: 'deny',
  },
  {
    name: 'payload root a string',
    guardrail: 'noPush',
    input: { raw: () => '"git push"' },
    expected: 'deny',
  },
  { name: 'invalid JSON', guardrail: 'noPush', input: { raw: () => 'not json at all' }, expected: 'deny' },
  {
    name: 'truncated JSON',
    guardrail: 'noPush',
    input: { raw: (t) => `{"tool_name":${JSON.stringify(t)},"tool_input":{"command":"git status"` },
    expected: 'deny',
  },
  {
    name: 'valid payload followed by garbage',
    guardrail: 'noPush',
    input: { raw: (t) => `${rawToolInput('{"command":"git status"}')(t)} trailing garbage` },
    expected: 'deny',
  },
  {
    name: 'two concatenated payloads, the second violating',
    guardrail: 'noPush',
    input: {
      raw: (t) =>
        `${rawToolInput('{"command":"git status"}')(t)}\n${rawToolInput('{"command":"git push"}')(t)}`,
    },
    expected: 'deny',
  },
  { name: 'empty stdin', guardrail: 'noPush', input: { raw: () => '' }, expected: 'deny' },
  { name: 'whitespace-only stdin', guardrail: 'noPush', input: { raw: () => ' \n\t\n' }, expected: 'deny' },
  { name: 'stdin a lone null', guardrail: 'noPush', input: { raw: () => 'null' }, expected: 'deny' },
];

const NPM_ONLY_CASES: AdversarialCase[] = [
  {
    name: 'plain allowed command',
    guardrail: 'npmOnly',
    input: { toolInput: { command: 'npm test' } },
    expected: 'allow',
  },
  {
    name: 'plain violation',
    guardrail: 'npmOnly',
    input: { toolInput: { command: 'git push' } },
    expected: 'deny',
  },
  {
    name: 'JSON \\u escape of the required prefix',
    guardrail: 'npmOnly',
    input: { raw: rawToolInput('{"command":"\\u006epm test"}') },
    expected: 'allow',
  },
  {
    name: 'fullwidth confusable of the required prefix',
    guardrail: 'npmOnly',
    input: { toolInput: { command: '\uFF4E\uFF50\uFF4D test' } },
    expected: 'deny',
  },
  { name: 'empty string', guardrail: 'npmOnly', input: { toolInput: { command: '' } }, expected: 'deny' },
  {
    name: 'whitespace only',
    guardrail: 'npmOnly',
    input: { toolInput: { command: '   ' } },
    expected: 'deny',
  },
  {
    name: 'a lone NUL',
    guardrail: 'npmOnly',
    input: { raw: rawToolInput('{"command":"\\u0000"}') },
    expected: 'deny',
  },
  { name: 'field missing', guardrail: 'npmOnly', input: { toolInput: {} }, expected: 'deny' },
  { name: 'field null', guardrail: 'npmOnly', input: { toolInput: { command: null } }, expected: 'deny' },
  { name: 'field false', guardrail: 'npmOnly', input: { toolInput: { command: false } }, expected: 'deny' },
  { name: 'field number', guardrail: 'npmOnly', input: { toolInput: { command: 0 } }, expected: 'deny' },
  {
    name: 'field array of an allowed string',
    guardrail: 'npmOnly',
    input: { toolInput: { command: ['npm test'] } },
    expected: 'deny',
  },
  {
    name: 'field object',
    guardrail: 'npmOnly',
    input: { toolInput: { command: { run: 'npm test' } } },
    expected: 'deny',
  },
  { name: 'tool_input missing', guardrail: 'npmOnly', input: { raw: withRoot({}) }, expected: 'deny' },
  { name: 'invalid JSON', guardrail: 'npmOnly', input: { raw: () => '{' }, expected: 'deny' },
  { name: 'empty stdin', guardrail: 'npmOnly', input: { raw: () => '' }, expected: 'deny' },
  {
    name: 'second command on a new line (matches tests the start only)',
    guardrail: 'npmOnly',
    input: { toolInput: { command: 'npm test\ngit push' } },
    expected: 'allow',
    limit: true,
  },
];

const NESTED_CASES: AdversarialCase[] = [
  {
    name: 'nested violation',
    guardrail: 'nested',
    input: { toolInput: { opts: { target: '/etc/passwd' } } },
    expected: 'deny',
  },
  {
    name: 'nested benign value',
    guardrail: 'nested',
    input: { toolInput: { opts: { target: '/tmp/x' } } },
    expected: 'allow',
  },
  {
    name: 'nested \\u escape',
    guardrail: 'nested',
    input: { raw: rawToolInput('{"opts":{"target":"\\u002fetc/passwd"}}') },
    expected: 'deny',
  },
  {
    name: 'path runs through a string',
    guardrail: 'nested',
    input: { toolInput: { opts: '/etc/passwd' } },
    expected: 'deny',
  },
  {
    name: 'path runs through an array',
    guardrail: 'nested',
    input: { toolInput: { opts: [{ target: '/etc' }] } },
    expected: 'deny',
  },
  {
    name: 'path runs through a number',
    guardrail: 'nested',
    input: { toolInput: { opts: 1 } },
    expected: 'deny',
  },
  {
    name: 'leaf an object',
    guardrail: 'nested',
    input: { toolInput: { opts: { target: { path: '/etc' } } } },
    expected: 'deny',
  },
  { name: 'parent null', guardrail: 'nested', input: { toolInput: { opts: null } }, expected: 'allow' },
  { name: 'parent missing', guardrail: 'nested', input: { toolInput: {} }, expected: 'allow' },
  {
    name: 'leaf one level too high',
    guardrail: 'nested',
    input: { toolInput: { target: '/etc' } },
    expected: 'allow',
  },
  {
    name: 'path matched at the payload root, outside tool_input',
    guardrail: 'nested',
    input: { raw: withRoot({ opts: { target: '/etc' }, tool_input: {} }) },
    expected: 'allow',
  },
  {
    name: 'dotted key is not a path',
    guardrail: 'nested',
    input: { toolInput: { 'opts.target': '/etc' } },
    expected: 'allow',
  },
];

export const ADVERSARIAL_CASES: readonly AdversarialCase[] = [
  ...NO_PUSH_CASES,
  ...NPM_ONLY_CASES,
  ...NESTED_CASES,
];
