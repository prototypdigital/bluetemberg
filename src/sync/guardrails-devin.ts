import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardrailFrontmatter, Platform } from '../types.js';
import type { ClaudeHooksSection } from './claude-hooks.js';
import { commitPlannedDelete, commitPlannedWrite, type SyncSink } from './pipeline.js';
import { buildGuardrailCommand, isGuardrailHookCommand } from './guardrails.js';
import { DEVIN_PLATFORM, normalizePlatforms } from './targets.js';

/**
 * Devin Desktop (formerly Windsurf) guardrail hooks, written to `.devin/hooks.v1.json`.
 *
 * Devin Local, the Desktop agent, shares Devin CLI's hook harness, and `.devin/hooks.v1.json` is its
 * standalone project hooks file in the Claude Code format: the whole file is the events map, each
 * event a list of `{ matcher, hooks: [{ type: 'command', command }] }` groups, with the call on stdin
 * as `{ tool_name, tool_input }`. Exit 2 blocks and its stderr is the reason handed to the agent;
 * exit 0 with no output carries on normally; any other exit, a timeout or unreadable output is logged
 * and does not block. So the Claude Code script runs unchanged: it prints nothing on a pass (never an
 * `approve` decision) and exits 2 itself when `jq` is missing or the payload cannot be read.
 * https://docs.devin.ai/cli/extensibility/hooks/overview
 */

const DEVIN_HOOKS_FILE = join('.devin', 'hooks.v1.json');

/**
 * Claude Code tool names (a guardrail's `trigger`) mapped to Devin's `tool_name`. Only tools whose
 * Devin `tool_input` is documented to carry the same argument names are listed: Devin's `exec` takes
 * `command`, like Claude's Bash. Anything else would compile to a check that reads the wrong field,
 * so it is left out until verified.
 * https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks
 */
const DEVIN_TOOL_NAMES: Readonly<Record<string, string>> = { Bash: 'exec' };

export interface DevinGuardrailsSyncContext extends SyncSink {
  platforms: readonly Platform[];
}

/** True when a guardrail's `platforms` (if set) names Devin, through its `windsurf` alias too. */
function targetsDevin(guardrail: GuardrailFrontmatter): boolean {
  if (!guardrail.platforms) return true;
  return normalizePlatforms(guardrail.platforms).includes(DEVIN_PLATFORM);
}

/**
 * Devin entries for the applicable guardrails, all on `PreToolUse`. A `PostToolUse` hook runs after
 * the call, so blocking there means nothing; such a guardrail stays Claude Code only rather than
 * compiling to a hook that runs and does nothing. Matchers are anchored because Devin matches them
 * as an unanchored regex on `tool_name`.
 */
function buildDevinGuardrailHooks(
  ctx: DevinGuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[],
): ClaudeHooksSection {
  const entries: ClaudeHooksSection[string] = [];
  const claudeOnly = new Set<string>();
  for (const guardrail of guardrails) {
    if (!targetsDevin(guardrail)) continue;
    const command = buildGuardrailCommand(guardrail);
    if (!command) continue;
    const toolName = DEVIN_TOOL_NAMES[guardrail.trigger];
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    if (!toolName || hookType !== 'PreToolUse') {
      claudeOnly.add(hookType === 'PreToolUse' ? guardrail.trigger : `${guardrail.trigger} (${hookType})`);
      continue;
    }
    entries.push({ matcher: `^${toolName}$`, hooks: [{ type: 'command', command }] });
  }

  if (!ctx.checkMode) {
    if (entries.length > 0) ctx.log(`Guardrails: ${entries.length} guardrail(s) -> ${DEVIN_HOOKS_FILE}`);
    if (claudeOnly.size > 0) {
      ctx.log(
        `Guardrails: no Devin equivalent for ${[...claudeOnly].join(', ')}; enforced in Claude Code only`,
      );
    }
  }
  return entries.length > 0 ? { PreToolUse: entries } : {};
}

type ExistingHooks =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'ok'; handWritten: Record<string, unknown[]>; generated: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Drops the guardrail commands an earlier sync generated from one matcher group. Returns the group
 * untouched when it holds none, the group without them when something else is left, and `null` when
 * they were all it held.
 */
function withoutGenerated(group: unknown, onGenerated: () => void): unknown {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) return group;
  const own = group.hooks.filter((hook) => {
    const command = isPlainObject(hook) ? hook.command : undefined;
    const generated = typeof command === 'string' && isGuardrailHookCommand(command);
    if (generated) onGenerated();
    return !generated;
  });
  if (own.length === group.hooks.length) return group;
  return own.length > 0 ? { ...group, hooks: own } : null;
}

/**
 * Reads the current `.devin/hooks.v1.json` and splits it into the guardrail commands an earlier
 * sync generated (recognized by their command) and everything else, which a person wrote. Event
 * order is kept so a rewrite does not reshuffle a hand-written file.
 */
function readExistingHooks(outPath: string): ExistingHooks {
  if (!existsSync(outPath)) return { status: 'absent' };
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (!isPlainObject(file)) return { status: 'invalid' };

  let generated = 0;
  const handWritten: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(file)) {
    if (!Array.isArray(groups)) return { status: 'invalid' };
    const survivors = groups
      .map((group) => withoutGenerated(group, () => generated++))
      .filter((group) => group !== null);
    // An event only generated groups kept alive goes with them; one written empty stays as written.
    if (survivors.length > 0 || groups.length === 0) handWritten[event] = survivors;
  }
  return { status: 'ok', handWritten, generated };
}

/** Per event: guardrail groups first, then the hand-written ones. */
function mergeHooks(
  guardrail: ClaudeHooksSection,
  handWritten: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = {};
  const events = new Set([...Object.keys(handWritten), ...Object.keys(guardrail)]);
  for (const event of events) {
    merged[event] = [...(guardrail[event] ?? []), ...(handWritten[event] ?? [])];
  }
  return merged;
}

function renderHooksFile(hooks: Record<string, readonly unknown[]>): string {
  return `${JSON.stringify(hooks, null, 2)}\n`;
}

/**
 * Single writer of `.devin/hooks.v1.json`. The file belongs to whoever wrote it: guardrail groups are
 * placed ahead of the hand-written ones, which are kept as they are. Commands an earlier sync
 * generated are replaced, or removed once their source is gone, which is also how `uninstall` clears
 * them. Never creates the file for nothing, deletes it when only guardrail groups kept it alive, and
 * leaves a file that is not a valid hooks object alone.
 *
 * `guardrails` is `null` when no guardrail sources exist.
 */
export function syncDevinGuardrailHooks(
  ctx: DevinGuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[] | null,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes(DEVIN_PLATFORM)) return;

  const outPath = join(ctx.root, DEVIN_HOOKS_FILE);
  const guardrailHooks = guardrails ? buildDevinGuardrailHooks(ctx, guardrails) : {};
  const hasGuardrailEntries = Object.keys(guardrailHooks).length > 0;
  const existing = readExistingHooks(outPath);
  if (existing.status === 'invalid') {
    if (hasGuardrailEntries) {
      recordError(
        `${DEVIN_HOOKS_FILE}: not a valid hooks file, so guardrail hooks were not added; fix or remove it`,
      );
    }
    return;
  }
  if (existing.status === 'absent') {
    if (hasGuardrailEntries) commitPlannedWrite(ctx, outPath, renderHooksFile(guardrailHooks));
    return;
  }
  if (!hasGuardrailEntries && existing.generated === 0) return;

  const hooks = mergeHooks(guardrailHooks, existing.handWritten);
  if (Object.keys(hooks).length === 0) {
    commitPlannedDelete(ctx, outPath);
  } else {
    commitPlannedWrite(ctx, outPath, renderHooksFile(hooks));
  }
  if (!ctx.checkMode && !hasGuardrailEntries) {
    ctx.log(`Hooks: removed ${existing.generated} guardrail hook(s) whose source is gone`);
  }
}
