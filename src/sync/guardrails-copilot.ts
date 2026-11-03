import { existsSync, readdirSync, readFileSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GuardrailFrontmatter, Platform } from '../types.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedDelete, commitPlannedWrite } from './pipeline.js';
import { buildCopilotGuardrailCommand, isGuardrailHookCommand } from './guardrails.js';

/**
 * GitHub Copilot guardrail hooks (Copilot CLI, Copilot cloud agent, and VS Code's Copilot harness,
 * which share one hook runtime): https://docs.github.com/en/copilot/reference/hooks-reference
 *
 * Every `*.json` file in `.github/hooks/` is loaded and combined, so the guardrails get a file of
 * their own and never share one with hooks a person wrote. The event is the PascalCase
 * `PreToolUse`, which selects the VS Code compatible payload: `tool_name` reports the Claude tool
 * name (`Bash`) and `tool_input` the parsed arguments, the shape the shared script reads.
 */
export const COPILOT_GUARDRAIL_HOOKS_FILE = join('.github', 'hooks', 'bluetemberg-guardrails.json');

const COPILOT_EVENT = 'PreToolUse';

/**
 * Claude Code tool names (a guardrail's `trigger`) mapped to the tool names the gate in the script
 * accepts. Copilot's PascalCase payload reports the Claude name, and the runtime name is accepted
 * too. Only `Bash` is listed: Copilot documents its shell tool's arguments as `{ command }`, the same
 * as Claude's Bash. Any other tool would compile to a check that may read the wrong field.
 */
const COPILOT_TOOL_NAMES: Readonly<Record<string, { matcher: string; gate: string }>> = {
  Bash: { matcher: 'Bash', gate: '^(Bash|bash)$' },
};

export interface CopilotGuardrailsSyncContext extends SyncSink {
  platforms: readonly Platform[];
}

/** A Copilot command hook entry as written to `.github/hooks/*.json`. */
interface CopilotHookEntry {
  type: 'command';
  bash: string;
  matcher: string;
}

/**
 * Single writer of `.github/hooks/bluetemberg-guardrails.json`. `guardrails` is `null` when no
 * guardrail sources exist, which still clears entries an earlier sync generated.
 */
export function syncCopilotGuardrailHooks(
  ctx: CopilotGuardrailsSyncContext,
  guardrails: readonly GuardrailFrontmatter[] | null,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes('copilot')) return;

  const entries = buildCopilotEntries(ctx, guardrails ?? []);
  const outPath = join(ctx.root, COPILOT_GUARDRAIL_HOOKS_FILE);
  const existing = readExisting(outPath);
  if (existing.status === 'invalid') {
    if (entries.length > 0) {
      recordError(
        `${COPILOT_GUARDRAIL_HOOKS_FILE}: not a valid hooks file, so guardrail hooks were not added; fix or remove it`,
      );
    }
    return;
  }
  if (existing.status === 'absent') {
    if (entries.length > 0)
      commitPlannedWrite(ctx, outPath, render({ version: 1 }, withEntries({}, entries)));
    return;
  }
  if (entries.length === 0 && existing.generated === 0) return;

  const hooks = withEntries(existing.handWritten, entries);
  const otherKeys = Object.keys(existing.file).filter((key) => key !== 'version' && key !== 'hooks');
  if (Object.keys(hooks).length === 0 && otherKeys.length === 0) {
    commitPlannedDelete(ctx, outPath);
    if (!ctx.checkMode) removeIfEmptyDir(dirname(outPath));
  } else {
    commitPlannedWrite(ctx, outPath, render(existing.file, hooks));
  }
  if (!ctx.checkMode && entries.length === 0) {
    ctx.log(`Hooks: removed ${existing.generated} Copilot guardrail hook(s) whose source is gone`);
  }
}

/**
 * Entries for the applicable guardrails. Copilot's `postToolUse` runs after the call and cannot
 * deny it, so a `PostToolUse` guardrail stays Claude Code only, like a trigger with no mapping.
 */
function buildCopilotEntries(
  ctx: CopilotGuardrailsSyncContext,
  guardrails: readonly GuardrailFrontmatter[],
): CopilotHookEntry[] {
  const entries: CopilotHookEntry[] = [];
  const claudeOnly = new Set<string>();
  for (const guardrail of guardrails) {
    if (guardrail.platforms && !guardrail.platforms.includes('copilot')) continue;
    const tool = COPILOT_TOOL_NAMES[guardrail.trigger];
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    if (!tool || hookType !== 'PreToolUse') {
      claudeOnly.add(hookType === 'PreToolUse' ? guardrail.trigger : `${guardrail.trigger} (${hookType})`);
      continue;
    }
    const command = buildCopilotGuardrailCommand(guardrail, tool.gate);
    if (!command) continue;
    entries.push({ type: 'command', bash: command, matcher: tool.matcher });
  }

  if (!ctx.checkMode) {
    if (entries.length > 0) {
      ctx.log(`Guardrails: ${entries.length} guardrail(s) -> ${COPILOT_GUARDRAIL_HOOKS_FILE}`);
    }
    if (claudeOnly.size > 0) {
      ctx.log(
        `Guardrails: no Copilot equivalent for ${[...claudeOnly].join(', ')}; enforced in Claude Code only`,
      );
    }
  }
  return entries;
}

type ExistingFile =
  | { status: 'absent' }
  | { status: 'invalid' }
  | {
      status: 'ok';
      file: Record<string, unknown>;
      handWritten: Record<string, unknown[]>;
      generated: number;
    };

/**
 * Splits the current file's entries into those an earlier sync generated (recognized by their
 * `bash` command) and everything else, which a person wrote and is kept as it is.
 */
function readExisting(outPath: string): ExistingFile {
  if (!existsSync(outPath)) return { status: 'absent' };
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (!isPlainObject(file)) return { status: 'invalid' };
  const hooks = file.hooks ?? {};
  if (!isPlainObject(hooks)) return { status: 'invalid' };

  let generated = 0;
  const handWritten: Record<string, unknown[]> = {};
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) return { status: 'invalid' };
    const survivors = list.filter((entry) => {
      const command = isPlainObject(entry) ? entry.bash : undefined;
      const isGenerated = typeof command === 'string' && isGuardrailHookCommand(command);
      if (isGenerated) generated++;
      return !isGenerated;
    });
    if (survivors.length > 0) handWritten[event] = survivors;
  }
  return { status: 'ok', file, handWritten, generated };
}

/** Guardrail entries first on their event, then the entries the file already holds. */
function withEntries(
  handWritten: Record<string, unknown[]>,
  entries: readonly CopilotHookEntry[],
): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> = {};
  if (entries.length > 0) hooks[COPILOT_EVENT] = [...entries, ...(handWritten[COPILOT_EVENT] ?? [])];
  for (const [event, list] of Object.entries(handWritten)) {
    if (event !== COPILOT_EVENT || entries.length === 0) hooks[event] = list;
  }
  return hooks;
}

function render(base: Record<string, unknown>, hooks: Record<string, unknown[]>): string {
  return `${JSON.stringify({ ...base, version: base.version ?? 1, hooks }, null, 2)}\n`;
}

function removeIfEmptyDir(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
