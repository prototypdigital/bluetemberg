import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { GuardrailFrontmatter, Platform } from '../types.js';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles } from './extends-loader.js';

export interface GuardrailsSyncContext extends SyncSink {
  /** All source dirs in priority order: local, then `extends`, then packs. */
  sourceDirs: string[];
  platforms: readonly Platform[];
}

function isGuardrailFrontmatter(data: unknown): data is GuardrailFrontmatter {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.trigger !== 'string' || !d.trigger) return false;
  if (typeof d.message !== 'string' || !d.message) return false;
  if (!d.check || typeof d.check !== 'object' || Array.isArray(d.check)) return false;
  const check = d.check as Record<string, unknown>;
  return typeof check.field === 'string' && check.field.length > 0;
}

/**
 * Builds the bash hook command for a Claude PreToolUse/PostToolUse hook from
 * structured guardrail frontmatter. Returns an empty string if no conditions are defined.
 *
 * Reads the tool input JSON from stdin, extracts `check.field`, then evaluates
 * the declared conditions; on failure it prints `message` and exits 2.
 */
function buildClaudeCommand(guardrail: GuardrailFrontmatter): string {
  const { check, message } = guardrail;
  const field = check.field;

  const conditions: string[] = [];
  if (check.not_empty) conditions.push(`-z "$${field}"`);
  if (check.not_matches) conditions.push(`"$${field}" =~ ${check.not_matches}`);
  if (check.matches) conditions.push(`! "$${field}" =~ ${check.matches}`);

  if (conditions.length === 0) return '';

  // Escape double quotes so the message is safe inside a bash double-quoted echo string.
  const escapedMessage = message.replace(/"/g, '\\"');

  return (
    `bash -c '${field}=$(cat | jq -r ".${field} // empty" 2>/dev/null); ` +
    `if [[ ${conditions.join(' || ')} ]]; then echo "${escapedMessage}"; exit 2; fi'`
  );
}

function readExistingSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // corrupt — start fresh
  }
  return {};
}

/**
 * Reads `guardrails/*.md` from all source dirs (local `llm/`, `extends`,
 * installed packs — same precedence as rules), translates each guardrail into
 * platform-specific hook config, and writes the result.
 *
 * Claude: merges a `hooks` section into `.claude/settings.json`.
 * Other platforms: no-op (not yet supported).
 *
 * The `hooks` section is fully regenerated on each sync — it is bluetemberg-owned.
 * All other keys in `settings.json` (e.g. `extraKnownMarketplaces`) are preserved.
 */
export function syncGuardrails(ctx: GuardrailsSyncContext, recordError: (message: string) => void): void {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'guardrails', (f) => f.endsWith('.md'));
  if (merged.size === 0) return;

  const guardrails: GuardrailFrontmatter[] = [];
  for (const [file, sourceDir] of merged) {
    try {
      const { data } = matter.read(join(sourceDir, file));
      if (!isGuardrailFrontmatter(data)) {
        recordError(`guardrails/${file}: invalid frontmatter — requires trigger, check.field, and message`);
        continue;
      }
      guardrails.push(data as GuardrailFrontmatter);
    } catch (err) {
      recordError(`guardrails/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (guardrails.length === 0) return;

  if (ctx.platforms.includes('claude')) {
    syncGuardrailsForClaude(ctx, guardrails, recordError);
  }
}

function syncGuardrailsForClaude(
  ctx: GuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[],
  recordError: (message: string) => void,
): void {
  const applicable = guardrails.filter((g) => !g.platforms || (g.platforms as string[]).includes('claude'));
  if (applicable.length === 0) return;

  // Group hook entries by hook_type (PreToolUse / PostToolUse).
  const byHookType = new Map<
    string,
    Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>
  >();

  for (const guardrail of applicable) {
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    const command = buildClaudeCommand(guardrail);
    if (!command) {
      recordError(`guardrails: ${guardrail.trigger} — no conditions defined, skipping`);
      continue;
    }
    if (!byHookType.has(hookType)) byHookType.set(hookType, []);
    byHookType.get(hookType)!.push({
      matcher: guardrail.trigger,
      hooks: [{ type: 'command', command }],
    });
  }

  if (byHookType.size === 0) return;

  const claudeDir = join(ctx.root, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // Preserve non-hooks keys (e.g. extraKnownMarketplaces written by marketplace sync).
  const existing = readExistingSettings(settingsPath);
  const hooksSection: Record<string, unknown> = {};
  for (const [hookType, entries] of byHookType) {
    hooksSection[hookType] = entries;
  }

  const updated: Record<string, unknown> = { ...existing, hooks: hooksSection };

  ensureDir(claudeDir);
  commitPlannedWrite(ctx, settingsPath, JSON.stringify(updated, null, 2) + '\n');

  if (!ctx.checkMode) {
    ctx.log(`Guardrails: ${applicable.length} guardrail(s) -> .claude/settings.json`);
  }
}
