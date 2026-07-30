import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { GuardrailFrontmatter, Platform, StackConstraint } from '../types.js';
import type { Catalog } from '../catalog/index.js';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles } from './extends-loader.js';
import { describeStackMismatch, matchStackConstraint, type DetectedStacks } from '../stacks/match.js';
import {
  buildStackMap,
  frontmatterStackIssues,
  readFrontmatterStacks,
  resolveStacks,
} from '../stacks/resolve.js';

export interface GuardrailsSyncContext extends SyncSink {
  /** All source dirs in priority order: local, then `extends`, then packs. */
  sourceDirs: string[];
  platforms: readonly Platform[];
  /** Pack catalog (drives the stack id→constraint map for version gating). */
  catalog: Catalog;
  /** Detected stacks + versions; a version-mismatched guardrail is hard-excluded. */
  detectedStacks: DetectedStacks;
}

/**
 * `check.field` becomes part of a `jq` filter (`.<field>`). Constrain it to a
 * dotted JSON-key path so it can never inject jq or shell syntax. Guardrails
 * are installed from third-party packs, so their content is untrusted.
 */
const SAFE_FIELD = /^[A-Za-z0-9_.-]+$/;

function isGuardrailFrontmatter(data: unknown): data is GuardrailFrontmatter {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.trigger !== 'string' || !d.trigger) return false;
  if (typeof d.message !== 'string' || !d.message) return false;
  if (!d.check || typeof d.check !== 'object' || Array.isArray(d.check)) return false;
  const check = d.check as Record<string, unknown>;
  return typeof check.field === 'string' && SAFE_FIELD.test(check.field);
}

/** Wrap an arbitrary string as a single POSIX shell token (`'...'`, with embedded `'` escaped). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Fixed hook script. Contains NO guardrail-derived content — the field, regexes,
 * and message arrive as positional parameters ($1..$5), so untrusted pack content
 * is never parsed as shell or jq code. `$2`/`$3` are used as the right-hand side of
 * `=~` (bash treats a variable RHS as a regex literal, not as code to evaluate).
 */
const CLAUDE_HOOK_SCRIPT = [
  'v=$(cat | jq -r ".$1 // empty" 2>/dev/null)',
  'fail=',
  'if [ -n "$5" ] && [ -z "$v" ]; then fail=1; fi',
  'if [ -n "$2" ] && [[ "$v" =~ $2 ]]; then fail=1; fi',
  'if [ -n "$3" ] && ! [[ "$v" =~ $3 ]]; then fail=1; fi',
  'if [ -n "$fail" ]; then printf "%s\\n" "$4"; exit 2; fi',
].join('; ');

/**
 * Builds the bash hook command for a Claude PreToolUse/PostToolUse hook from
 * structured guardrail frontmatter. Returns an empty string if no conditions are defined.
 *
 * The tool-input field, condition regexes, and message are passed as shell-quoted
 * positional arguments to a fixed script — never interpolated into the script body —
 * so hostile pack content cannot achieve shell or jq injection.
 */
function buildClaudeCommand(guardrail: GuardrailFrontmatter): string {
  const { check, message } = guardrail;

  if (!check.not_empty && !check.matches && !check.not_matches) return '';

  const args = [
    check.field,
    check.not_matches ?? '',
    check.matches ?? '',
    message,
    check.not_empty ? '1' : '',
  ];

  return `bash -c ${shellQuote(CLAUDE_HOOK_SCRIPT)} bluetemberg ${args.map(shellQuote).join(' ')}`;
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

  const stackMap = buildStackMap(ctx.catalog);
  const guardrails: GuardrailFrontmatter[] = [];
  const excluded = new Map<string, string>();
  for (const [file, sourceDir] of merged) {
    try {
      const { data } = matter.read(join(sourceDir, file));
      // Capture the raw record before the type guard narrows `data` to GuardrailFrontmatter.
      const record = data as Record<string, unknown>;
      if (!isGuardrailFrontmatter(data)) {
        recordError(`guardrails/${file}: invalid frontmatter — requires trigger, check.field, and message`);
        continue;
      }
      const reason = versionFilterReason(ctx, file, record, stackMap);
      if (reason !== null) {
        excluded.set(file, reason);
        continue;
      }
      guardrails.push(data);
    } catch (err) {
      recordError(`guardrails/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log(`Guardrails: ${merged.size} source files`);
  if (excluded.size > 0) {
    // Per-file reasons (parity with rules): the user can audit that wrong-version guardrails were
    // correctly withheld, rather than seeing only an opaque count.
    ctx.log(`  ${guardrails.length} applied · ${excluded.size} filtered out by version`);
    for (const [file, reason] of excluded) {
      ctx.log(`    - ${basename(file, '.md')}: ${reason}`);
    }
  }

  // Always run the Claude pass when targeted — even with zero surviving guardrails — so a hooks
  // section left by an earlier sync is cleared. Otherwise a version-filtered guardrail's hook would
  // persist in settings.json, silently defeating the hard-exclusion guarantee.
  if (ctx.platforms.includes('claude')) {
    syncGuardrailsForClaude(ctx, guardrails, recordError);
  }
}

/**
 * Remove the bluetemberg-owned `hooks` section from `.claude/settings.json`, preserving every other
 * key. No-op when the file or the `hooks` key is absent — so a project that never had guardrails is
 * never given an empty settings file.
 */
function clearManagedHooks(ctx: GuardrailsSyncContext): void {
  const settingsPath = join(ctx.root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;
  const existing = readExistingSettings(settingsPath);
  if (!Object.prototype.hasOwnProperty.call(existing, 'hooks')) return;

  const cleared = { ...existing };
  delete cleared.hooks;
  commitPlannedWrite(ctx, settingsPath, JSON.stringify(cleared, null, 2) + '\n');
  if (!ctx.checkMode) {
    ctx.log('Guardrails: cleared previously managed hooks (no applicable guardrails)');
  }
}

/**
 * Returns the exclusion reason when a guardrail's stack constraint (frontmatter `stacks:` > catalog
 * pack-level) is NOT satisfied by the project's detected stacks — i.e. it targets a stack/version
 * the project does not use, so it must be hard-excluded — or `null` when it applies. Stack-agnostic
 * guardrails always apply. Invalid frontmatter ranges and low-confidence detection are surfaced as
 * warnings, never silently dropped.
 */
function versionFilterReason(
  ctx: GuardrailsSyncContext,
  file: string,
  data: Record<string, unknown>,
  stackMap: Map<string, StackConstraint>,
): string | null {
  const issues = frontmatterStackIssues(data);
  if (issues.length > 0) {
    const msg = `guardrails/${file}: ignored invalid stack range(s) ${issues.join(', ')} — fix the range or the guardrail may apply to unintended versions`;
    ctx.results.warnings.push(msg);
    ctx.log(`  WARN: ${msg}`);
  }
  const constraint = resolveStacks(basename(file, '.md'), readFrontmatterStacks(data), stackMap);
  const result = matchStackConstraint(constraint, ctx.detectedStacks);
  if (result.lowConfidence.length > 0) {
    const msg = `guardrails/${file}: matched via low-confidence detection for ${result.lowConfidence.join(', ')} — pin a version in bluetemberg.config.json for precision`;
    ctx.results.warnings.push(msg);
    ctx.log(`  WARN: ${msg}`);
  }
  return result.matched ? null : describeStackMismatch(result);
}

function syncGuardrailsForClaude(
  ctx: GuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[],
  recordError: (message: string) => void,
): void {
  const applicable = guardrails.filter((g) => !g.platforms || (g.platforms as string[]).includes('claude'));

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

  // Nothing to write (all guardrails filtered out, non-Claude, or condition-less): clear any hooks
  // a prior sync left behind, rather than leaving stale entries active.
  if (byHookType.size === 0) {
    clearManagedHooks(ctx);
    return;
  }

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
