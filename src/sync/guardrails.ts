import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { GuardrailCheck, GuardrailFrontmatter, Platform, StackConstraint } from '../types.js';
import type { Catalog } from '../catalog/index.js';
import type { SyncSink } from './pipeline.js';
import type { ClaudeHooksSection } from './claude-hooks.js';
import { mergeSourceFiles } from './extends-loader.js';
import { ereIssue } from './ere.js';
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
  if (typeof check.field !== 'string' || !SAFE_FIELD.test(check.field)) return false;
  // A non-string regex (a YAML number, list, or map) would reach `shellQuote` as a
  // non-string and fail there with a type error; reject the shape up front instead.
  return isOptionalString(check.matches) && isOptionalString(check.not_matches);
}

/** True when a frontmatter value is absent (missing or an empty YAML key) or a string. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * Returns the reason a guardrail's condition regexes cannot be trusted, or `null` when both
 * are valid POSIX ERE.
 *
 * A pattern that is not valid ERE cannot be evaluated by the generated hook. The
 * `not_matches` test used to read the resulting bash status 2 as "no match" and allow the
 * tool call, so a guardrail could read as protective in review and never fire
 * (GHSA-grpx-fj8v-q8g9). The hook now fails closed, but that alone turns an author's typo
 * into a hook that denies every matching tool call — rejecting the pattern here is the
 * layer that names the offending regex instead, at the point it can still be fixed.
 */
function guardrailRegexIssue(check: GuardrailCheck): string | null {
  const conditions = [
    ['matches', check.matches],
    ['not_matches', check.not_matches],
  ] as const;

  for (const [key, pattern] of conditions) {
    if (!pattern) continue;
    const issue = ereIssue(pattern);
    if (issue) return `check.${key} is not valid POSIX ERE — ${issue}`;
  }

  return null;
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
 *
 * Each `=~` status is captured explicitly rather than folded into an `&&` chain, because
 * bash returns 2 — not 1 — when the pattern fails to compile. Read through `&&` that status
 * is falsey, so a `not_matches` whose regex was not valid ERE exited 0 and allowed the call
 * (GHSA-grpx-fj8v-q8g9). A condition that cannot be evaluated now blocks: status 1 (a clean
 * non-match) is the only outcome that lets `not_matches` pass, and status 0 the only one
 * that lets `matches` pass. The compile failure is reported as itself, not as the
 * guardrail's message, so a broken pattern is not mistaken for a violated rule.
 */
const CLAUDE_HOOK_SCRIPT = [
  'v=$(cat | jq -r ".$1 // empty" 2>/dev/null)',
  'fail=',
  'bad=',
  'if [ -n "$5" ] && [ -z "$v" ]; then fail=1; fi',
  'if [ -n "$2" ]; then [[ "$v" =~ $2 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -eq 0 ]; then fail=1; fi; fi',
  'if [ -n "$3" ]; then [[ "$v" =~ $3 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -ne 0 ]; then fail=1; fi; fi',
  'if [ -n "$bad" ]; then printf "bluetemberg guardrail: the condition regex for field .%s is not valid POSIX ERE, so the condition cannot be evaluated. Blocking; fix the guardrail regex.\\n" "$1" >&2; exit 2; fi',
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

/**
 * Reads `guardrails/*.md` from all source dirs (local `llm/`, `extends`,
 * installed packs — same precedence as rules) and translates each guardrail into
 * platform-specific hook config.
 *
 * Claude: returns the guardrail-generated hook entries for the `hooks` section of
 * `.claude/settings.json`. The actual write is owned by `syncClaudeHooks`, which composes
 * these entries with the project's `llm/hooks.claude.json` (see the precedence contract
 * there). Returns `null` when no guardrail sources exist or `claude` is not targeted; an
 * empty section means guardrail sources exist but none currently apply (so a previously
 * managed `hooks` key must be cleared, not left stale).
 *
 * Other platforms: no-op (not yet supported).
 */
export function syncGuardrails(
  ctx: GuardrailsSyncContext,
  recordError: (message: string) => void,
): ClaudeHooksSection | null {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'guardrails', (f) => f.endsWith('.md'));
  if (merged.size === 0) return null;

  const stackMap = buildStackMap(ctx.catalog);
  const guardrails: GuardrailFrontmatter[] = [];
  const excluded = new Map<string, string>();
  for (const [file, sourceDir] of merged) {
    try {
      const { data } = matter.read(join(sourceDir, file));
      // Capture the raw record before the type guard narrows `data` to GuardrailFrontmatter.
      const record = data as Record<string, unknown>;
      if (!isGuardrailFrontmatter(data)) {
        recordError(
          `guardrails/${file}: invalid frontmatter — requires trigger, check.field, and message; check.matches/not_matches must be strings when present`,
        );
        continue;
      }
      const regexIssue = guardrailRegexIssue(data.check);
      if (regexIssue !== null) {
        recordError(`guardrails/${file}: ${regexIssue}`);
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

  // Always run the Claude pass when targeted — even with zero surviving guardrails — so the
  // downstream writer knows guardrail sources exist and clears a hooks section left by an earlier
  // sync. Otherwise a version-filtered guardrail's hook would persist in settings.json, silently
  // defeating the hard-exclusion guarantee.
  if (!ctx.platforms.includes('claude')) return null;
  return buildGuardrailHooksSection(ctx, guardrails, recordError);
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

/**
 * Compile applicable guardrails into hook entries grouped by hook_type (PreToolUse /
 * PostToolUse). Pure computation — the write into `.claude/settings.json` is owned by
 * `syncClaudeHooks`, so the file's `hooks` key has exactly one writer per sync.
 */
function buildGuardrailHooksSection(
  ctx: GuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[],
  recordError: (message: string) => void,
): ClaudeHooksSection {
  const applicable = guardrails.filter((g) => !g.platforms || (g.platforms as string[]).includes('claude'));

  const section: ClaudeHooksSection = {};
  for (const guardrail of applicable) {
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    const command = buildClaudeCommand(guardrail);
    if (!command) {
      recordError(`guardrails: ${guardrail.trigger} — no conditions defined, skipping`);
      continue;
    }
    (section[hookType] ??= []).push({
      matcher: guardrail.trigger,
      hooks: [{ type: 'command', command }],
    });
  }

  if (!ctx.checkMode && Object.keys(section).length > 0) {
    ctx.log(`Guardrails: ${applicable.length} guardrail(s) -> .claude/settings.json`);
  }

  return section;
}
