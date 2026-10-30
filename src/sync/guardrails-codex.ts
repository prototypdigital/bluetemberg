import { stringify as tomlStringify } from 'smol-toml';
import type { GuardrailFrontmatter } from '../types.js';
import type { SyncSink } from './pipeline.js';

/** One `[[hooks.PreToolUse]]` matcher group in `.codex/config.toml`. */
export interface CodexHookEntry {
  matcher: string;
  hooks: { type: 'command'; command: string; commandWindows: string }[];
}

/** Matcher groups by Codex event; guardrails only ever compile to `PreToolUse`. */
export interface CodexHooksSection {
  PreToolUse?: CodexHookEntry[];
}

/**
 * Claude Code tool names (a guardrail's `trigger`) mapped to Codex's hook `tool_name`, with the
 * `tool_input` fields both sides carry. Codex reports its shell tool as `Bash` with only
 * `tool_input: { command }`, the shell string (`exec_command`'s `cmd`). Claude's Bash also takes
 * `description`, `timeout` and `run_in_background`; a check on one of those would read an empty
 * value in Codex, so `not_empty` would block every shell call and `not_matches` would never fire.
 * `apply_patch` answers to `Write`/`Edit` matchers but takes `{ command: <patch> }`, not Claude's
 * `file_path`/`content`, so it is left out.
 */
const CODEX_TOOLS: Readonly<Record<string, { name: string; fields: readonly string[] }>> = {
  Bash: { name: 'Bash', fields: ['command'] },
};

/**
 * What Codex runs on Windows instead of `command`. Its session shell there is PowerShell or `cmd`,
 * which cannot parse the POSIX-quoted script. Left unset, Codex would hand them `command` itself,
 * and `cmd` would read `&` or `|` in a pack's message or regex as a command separator. This fixed,
 * pack-free name is not a command, so either shell fails to run it: Codex reports a hook error and
 * lets the call through, the same as any other hook failure. Guardrails are not enforced there.
 */
export const CODEX_WINDOWS_COMMAND = 'bluetemberg-guardrails-need-bash-not-enforced-on-windows';

/** The path under `tool_input` a field names (a leading `tool_input.` is dropped, as for Claude). */
function toolInputField(field: string): string {
  return field.startsWith('tool_input.') ? field.slice('tool_input.'.length) : field;
}

/** Why a guardrail cannot compile for Codex, or `null` when it can. */
function codexGapReason(guardrail: GuardrailFrontmatter): string | null {
  const hookType = guardrail.hook_type ?? 'PreToolUse';
  if (hookType !== 'PreToolUse') return `${guardrail.trigger} (${hookType})`;
  const tool = CODEX_TOOLS[guardrail.trigger];
  if (!tool) return guardrail.trigger;
  const field = toolInputField(guardrail.check.field);
  if (!tool.fields.includes(field)) return `${guardrail.trigger} (field ${field})`;
  return null;
}

/**
 * Codex entries for the applicable guardrails, all on `PreToolUse`. The command is the Claude one
 * unchanged: Codex blocks on exit 2 with the reason on stderr, which is what it prints, and reads an
 * exit 0 with empty stdout as "continue", not as an approval. A missing `jq` or unreadable payload
 * exits 2 with its own message, so it blocks too. `PostToolUse` guardrails stay Claude Code only, the
 * same as for Cursor: by then the call has already run.
 *
 * Codex fails open on everything else: a timeout, a crash, any other exit code, an `async` handler,
 * and a hook nobody has trusted yet. So entries never set `async`, and the sync log says to trust the
 * hooks with `/hooks`. It also fails open on Windows (see {@link CODEX_WINDOWS_COMMAND}) and for
 * `write_stdin`, which emits no `PreToolUse` at all.
 */
export function buildCodexGuardrailHooks(
  ctx: SyncSink,
  guardrails: readonly GuardrailFrontmatter[],
  compile: (guardrail: GuardrailFrontmatter) => string,
): CodexHooksSection {
  const entries: CodexHookEntry[] = [];
  const claudeOnly = new Set<string>();
  for (const guardrail of guardrails) {
    if (guardrail.platforms && !(guardrail.platforms as string[]).includes('codex')) continue;
    const command = compile(guardrail);
    if (!command) continue;
    const gap = codexGapReason(guardrail);
    if (gap !== null) {
      claudeOnly.add(gap);
      continue;
    }
    const toolName = CODEX_TOOLS[guardrail.trigger]?.name ?? guardrail.trigger;
    entries.push({
      matcher: `^${toolName}$`,
      hooks: [{ type: 'command', command, commandWindows: CODEX_WINDOWS_COMMAND }],
    });
  }

  if (!ctx.checkMode) {
    if (entries.length > 0) {
      ctx.log(
        `Guardrails: ${entries.length} guardrail(s) -> .codex/config.toml (Codex runs them only once trusted: review with /hooks)`,
      );
    }
    if (claudeOnly.size > 0) {
      ctx.log(
        `Guardrails: no Codex equivalent for ${[...claudeOnly].join(', ')}; enforced in Claude Code only`,
      );
    }
  }
  return entries.length > 0 ? { PreToolUse: entries } : {};
}

/** The managed hooks block's body, or `''` when there is nothing to enforce (which removes the block). */
export function renderCodexHooksBlock(section: CodexHooksSection | null): string {
  if (!section?.PreToolUse?.length) return '';
  return tomlStringify({ hooks: section }).trim();
}

/** True when the config turns Codex hooks off (`[features] hooks = false`, or the old `codex_hooks`). */
export function codexHooksDisabled(config: Record<string, unknown>): boolean {
  const features = config.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return false;
  const flags = features as Record<string, unknown>;
  return flags.hooks === false || flags.codex_hooks === false;
}
