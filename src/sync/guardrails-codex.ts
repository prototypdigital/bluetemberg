import { stringify as tomlStringify } from 'smol-toml';
import type { GuardrailFrontmatter } from '../types.js';
import type { SyncSink } from './pipeline.js';

/** One `[[hooks.PreToolUse]]` matcher group in `.codex/config.toml`. */
export interface CodexHookEntry {
  matcher: string;
  hooks: { type: 'command'; command: string }[];
}

/** Matcher groups by Codex event; guardrails only ever compile to `PreToolUse`. */
export interface CodexHooksSection {
  PreToolUse?: CodexHookEntry[];
}

/**
 * Claude Code tool names (a guardrail's `trigger`) mapped to Codex's hook `tool_name`. Only tools whose
 * Codex `tool_input` carries the same argument names are listed. Codex reports its shell tool as `Bash`
 * with `tool_input: { command }`, where `command` is the shell string (`exec_command`'s `cmd`), so a
 * check written against Claude's Bash reads the same field. `apply_patch` answers to `Write`/`Edit`
 * matchers but takes `{ command: <patch> }`, not Claude's `file_path`/`content`, so it is left out.
 */
const CODEX_TOOL_NAMES: Readonly<Record<string, string>> = { Bash: 'Bash' };

/**
 * Codex entries for the applicable guardrails, all on `PreToolUse`. The command is the Claude one
 * unchanged: Codex blocks on exit 2 with the reason on stderr, which is what it prints, and reads an
 * exit 0 with empty stdout as "continue", not as an approval. A missing `jq` or unreadable payload
 * exits 2 with its own message, so it blocks too. `PostToolUse` guardrails stay Claude Code only, the
 * same as for Cursor: by then the call has already run.
 *
 * Codex fails open on everything else: a timeout, a crash, any other exit code, an `async` handler,
 * and a hook nobody has trusted yet. So entries never set `async`, and the sync log says to trust the
 * hooks with `/hooks`.
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
    const toolName = CODEX_TOOL_NAMES[guardrail.trigger];
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    if (!toolName || hookType !== 'PreToolUse') {
      claudeOnly.add(hookType === 'PreToolUse' ? guardrail.trigger : `${guardrail.trigger} (${hookType})`);
      continue;
    }
    entries.push({ matcher: `^${toolName}$`, hooks: [{ type: 'command', command }] });
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
