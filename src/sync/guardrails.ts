import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { GuardrailCheck, GuardrailFrontmatter, Platform } from '../types.js';
import type { Catalog } from '../catalog/index.js';
import type { SyncSink } from './pipeline.js';
import type { ClaudeHooksSection } from './claude-hooks.js';
import type { CursorHookEntry, CursorHooksSection } from './hooks.js';
import { mergeSourceFiles } from './extends-loader.js';
import { ereIssue } from './ere.js';
import {
  describeLowConfidence,
  describeStackMismatch,
  matchStackConstraint,
  type DetectedStacks,
} from '../stacks/match.js';
import {
  buildStackMap,
  frontmatterStackIssues,
  readFrontmatterStacks,
  resolveStacks,
  type StackMap,
} from '../stacks/resolve.js';

export interface GuardrailsSyncContext extends SyncSink {
  /** All source dirs in priority order: local, then `extends`, then packs. */
  sourceDirs: string[];
  platforms: readonly Platform[];
  /** Pack catalog (drives the stack id→constraint map for version gating). */
  catalog: Catalog;
  /** Detected stacks + versions; a version-mismatched guardrail is hard-excluded. */
  detectedStacks: DetectedStacks;
  /** Low-confidence stacks already warned about this sync (shared with the rule/agent/skill gate). */
  warnedLowConfidence: Set<string>;
}

/**
 * `check.field` is a dotted JSON-key path (`name`, `tool_input.name`, `file-path`). The hook hands
 * it to `jq` as data (`--arg`) and splits it into a `getpath` path, so it is never parsed as jq or
 * shell syntax; the pattern still keeps it a plain path with no empty segments, since guardrails are
 * installed from third-party packs and their content is untrusted.
 */
const SAFE_FIELD = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

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
 *
 * `check.field` is a path into the tool's arguments, which every host nests under `tool_input`,
 * and only there is it read: the payload root carries host keys (`cwd`, `session_id`, ...) that a
 * missing or `null` argument of the same name must not fall through to. A path written against the
 * whole payload (`tool_input.name`) is normalized before it reaches the script (`toolInputPath`).
 * The path reaches jq as `--arg` data and is resolved
 * with `getpath`, so a key jq cannot spell as `.a.b` (`file-path`, `0`) still reads correctly. A
 * jq failure (jq missing, a payload that is not JSON or not shaped like the path) blocks instead
 * of reading as an empty value, which would let a `not_matches` check pass. The block message goes
 * to stderr, the stream Claude Code feeds back to the model on exit 2.
 */
const GUARDRAIL_CHECK_STEPS = [
  `v=$(jq -r --arg f "$1" '($f / ".") as $p | .tool_input | getpath($p) // empty' 2>/dev/null)`,
  'if [ "$?" -ne 0 ]; then printf "bluetemberg guardrail: could not read field .%s from the hook payload (is jq installed?), so the condition cannot be evaluated. Blocking.\\n" "$1" >&2; exit 2; fi',
  'fail=',
  'bad=',
  'if [ -n "$5" ] && [ -z "$v" ]; then fail=1; fi',
  'if [ -n "$2" ]; then [[ "$v" =~ $2 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -eq 0 ]; then fail=1; fi; fi',
  'if [ -n "$3" ]; then [[ "$v" =~ $3 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -ne 0 ]; then fail=1; fi; fi',
  'if [ -n "$bad" ]; then printf "bluetemberg guardrail: the condition regex for field .%s is not valid POSIX ERE, so the condition cannot be evaluated. Blocking; fix the guardrail regex.\\n" "$1" >&2; exit 2; fi',
];

/** A violated check: the guardrail's message on stderr, exit 2. */
const CLAUDE_DENY_STEP = 'if [ -n "$fail" ]; then printf "%s\\n" "$4" >&2; exit 2; fi';

const CLAUDE_HOOK_SCRIPT = [...GUARDRAIL_CHECK_STEPS, CLAUDE_DENY_STEP].join('; ');

/**
 * Scripts earlier engines generated. A settings file synced by one of them still carries its
 * command, and orphan cleanup must recognize it as a guardrail hook once the source is gone.
 * Both read `.<field>` from the payload root (always empty for tool arguments, which Claude Code
 * nests under `tool_input`) and printed the block message to stdout, which Claude ignores. The
 * first (v0.6.0–v0.12.0) also let a `not_matches` regex that failed to compile pass.
 */
const LEGACY_CLAUDE_HOOK_SCRIPTS = [
  [
    'v=$(cat | jq -r ".$1 // empty" 2>/dev/null)',
    'fail=',
    'if [ -n "$5" ] && [ -z "$v" ]; then fail=1; fi',
    'if [ -n "$2" ] && [[ "$v" =~ $2 ]]; then fail=1; fi',
    'if [ -n "$3" ] && ! [[ "$v" =~ $3 ]]; then fail=1; fi',
    'if [ -n "$fail" ]; then printf "%s\\n" "$4"; exit 2; fi',
  ].join('; '),
  [
    'v=$(cat | jq -r ".$1 // empty" 2>/dev/null)',
    'fail=',
    'bad=',
    'if [ -n "$5" ] && [ -z "$v" ]; then fail=1; fi',
    'if [ -n "$2" ]; then [[ "$v" =~ $2 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -eq 0 ]; then fail=1; fi; fi',
    'if [ -n "$3" ]; then [[ "$v" =~ $3 ]]; s=$?; if [ "$s" -eq 2 ]; then bad=1; elif [ "$s" -ne 0 ]; then fail=1; fi; fi',
    'if [ -n "$bad" ]; then printf "bluetemberg guardrail: the condition regex for field .%s is not valid POSIX ERE, so the condition cannot be evaluated. Blocking; fix the guardrail regex.\\n" "$1" >&2; exit 2; fi',
    'if [ -n "$fail" ]; then printf "%s\\n" "$4"; exit 2; fi',
  ].join('; '),
];

/**
 * Builds the bash hook command for a Claude PreToolUse/PostToolUse hook from
 * structured guardrail frontmatter. Returns an empty string if no conditions are defined.
 *
 * The tool-input field, condition regexes, and message are passed as shell-quoted
 * positional arguments to a fixed script — never interpolated into the script body —
 * so hostile pack content cannot achieve shell or jq injection.
 */
/**
 * Cursor runs the same checks, and a passing call prints `{}`. Cursor's entries are `failClosed`, and
 * a `failClosed` hook that prints nothing counts as failed, so silence would block every call. `{}`
 * carries no `permission`, so it never auto-approves anything. A failure (a violated check, or `jq`
 * missing or unable to read the payload) still exits 2 with nothing on stdout.
 */
const CURSOR_HOOK_SCRIPT = [CLAUDE_HOOK_SCRIPT, 'printf "{}\\n"'].join('; ');

/**
 * GitHub Copilot runs the same checks behind a tool-name gate, and denies with a JSON reason.
 *
 * The gate: `$6` is an anchored ERE of the tool names the guardrail applies to (set by the engine,
 * never by a pack). VS Code's Local harness also loads `.github/hooks/*.json` but ignores `matcher`,
 * so without the gate a check would run against every tool's arguments (a `not_empty` guardrail
 * would deny every call). The payload is read once and replayed on stdin (`exec <<<`) for the shared
 * steps. A payload with no string `tool_name` blocks rather than reading as "another tool": that is
 * the camelCase `toolName`/`toolArgs` shape, which the shared steps cannot read, and skipping it
 * would let every call through.
 *
 * The deny: Copilot shows the agent `permissionDecisionReason` from stdout, which it merges with the
 * exit-2 deny, so the message goes there as well as to stderr. jq builds that JSON from `$4` as
 * data. A passing call exits 0 with no output, which Copilot reads as "no decision": it never
 * auto-approves. Any other failure exits non-zero, which Copilot treats as a deny for `preToolUse`.
 */
const COPILOT_HOOK_SCRIPT = [
  'in=$(cat)',
  `t=$(printf "%s" "$in" | jq -r 'if (.tool_name | type) == "string" then .tool_name else error("no tool_name") end' 2>/dev/null)`,
  'if [ "$?" -ne 0 ]; then printf "bluetemberg guardrail: could not read tool_name from the hook payload (is jq installed?), so the condition cannot be evaluated. Blocking.\\n" >&2; exit 2; fi',
  '[[ "$t" =~ $6 ]]; s=$?; if [ "$s" -eq 2 ]; then printf "bluetemberg guardrail: invalid tool-name pattern. Blocking.\\n" >&2; exit 2; elif [ "$s" -ne 0 ]; then exit 0; fi',
  'exec <<<"$in"',
  ...GUARDRAIL_CHECK_STEPS,
  `if [ -n "$fail" ]; then printf "%s\\n" "$4" >&2; jq -cn --arg r "$4" '{permissionDecision: "deny", permissionDecisionReason: $r}'; exit 2; fi`,
].join('; ');

/** The fixed prefix every generated guardrail command starts with; `$0` is literally `bluetemberg`. */
const TOOL_INPUT_PREFIX = 'tool_input.';
function commandPrefix(script: string): string {
  return `bash -c ${shellQuote(script)} bluetemberg `;
}
const KNOWN_COMMAND_PREFIXES = [
  CLAUDE_HOOK_SCRIPT,
  CURSOR_HOOK_SCRIPT,
  COPILOT_HOOK_SCRIPT,
  ...LEGACY_CLAUDE_HOOK_SCRIPTS,
].map(commandPrefix);

/**
 * True for a hook command this module generated. Lets the settings writer tell a guardrail's hook
 * from one a person wrote by hand, so the former can be removed when its source disappears and
 * the latter is never touched.
 */
export function isGuardrailHookCommand(command: string): boolean {
  return KNOWN_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix));
}

/** The path under `tool_input` a field names; a field written as a full payload path drops its `tool_input.` prefix. */
function toolInputPath(field: string): string {
  return field.startsWith(TOOL_INPUT_PREFIX) ? field.slice(TOOL_INPUT_PREFIX.length) : field;
}

/**
 * The Copilot hook command for a guardrail, gated to the tool names `toolNamePattern` (an anchored
 * ERE the engine supplies) matches. Empty when the guardrail defines no conditions.
 */
export function buildCopilotGuardrailCommand(
  guardrail: GuardrailFrontmatter,
  toolNamePattern: string,
): string {
  return buildGuardrailCommand(guardrail, COPILOT_HOOK_SCRIPT, [toolNamePattern]);
}

export function buildGuardrailCommand(
  guardrail: GuardrailFrontmatter,
  script = CLAUDE_HOOK_SCRIPT,
  extraArgs: readonly string[] = [],
): string {
  const { check, message } = guardrail;

  if (!check.not_empty && !check.matches && !check.not_matches) return '';

  const args = [
    toolInputPath(check.field),
    check.not_matches ?? '',
    check.matches ?? '',
    message,
    check.not_empty ? '1' : '',
    ...extraArgs,
  ];

  return `${commandPrefix(script)}${args.map(shellQuote).join(' ')}`;
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
 * Cursor: returns `preToolUse` entries for `.cursor/hooks.json`, written by `syncHooks` together
 * with `llm/hooks.json`. Only `PreToolUse` guardrails whose trigger has a verified Cursor equivalent
 * compile (see {@link CURSOR_TOOL_NAMES}); the rest are logged as Claude Code only.
 *
 * Copilot: compiled and written by `syncCopilotGuardrailHooks` (`guardrails-copilot.ts`) from
 * `applied`, the guardrails that survive validation and version gating.
 *
 * Devin: compiled and written by `syncDevinGuardrailHooks` (`guardrails-devin.ts`) from `applied`.
 *
 * Other platforms: no-op (not yet supported).
 */
export function syncGuardrails(
  ctx: GuardrailsSyncContext,
  recordError: (message: string) => void,
): GuardrailHooks {
  const merged = mergeSourceFiles(ctx.sourceDirs, 'guardrails', (f) => f.endsWith('.md'));
  if (merged.size === 0) return { claude: null, cursor: null, applied: null };

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
      const reason = versionFilterReason(ctx, file, sourceDir, record, stackMap);
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
  return {
    claude: ctx.platforms.includes('claude')
      ? buildGuardrailHooksSection(ctx, guardrails, recordError)
      : null,
    cursor: ctx.platforms.includes('cursor') ? buildCursorGuardrailHooks(ctx, guardrails) : null,
    applied: guardrails,
  };
}

/**
 * Hook entries per platform. `null` means no guardrail sources exist (or the platform is not
 * targeted), so the writer must not treat its hooks as guardrail-owned; an empty section means
 * sources exist but none currently apply, so previously generated entries must be cleared.
 */
export interface GuardrailHooks {
  claude: ClaudeHooksSection | null;
  cursor: CursorHooksSection | null;
  /**
   * The guardrails that passed validation and version gating, for host writers that live in their
   * own module (`guardrails-copilot.ts`, `guardrails-devin.ts`); `null` when no guardrail sources exist.
   */
  applied: GuardrailFrontmatter[] | null;
}

/**
 * Claude Code tool names (a guardrail's `trigger`) mapped to Cursor's `tool_name`. Only tools whose
 * Cursor `tool_input` is documented to carry the same argument names are listed: Cursor's Shell
 * takes `command`, like Claude's Bash. Anything else would compile to a check that reads the wrong
 * field, so it is left out until verified.
 */
const CURSOR_TOOL_NAMES: Readonly<Record<string, string>> = { Bash: 'Shell' };

/**
 * Cursor entries for the applicable guardrails, all on `preToolUse`. Cursor's `postToolUse` cannot
 * block or relay a message on exit 2, so a `PostToolUse` guardrail stays Claude Code only rather
 * than compiling to a hook that runs and does nothing. `failClosed` makes a crash or timeout block
 * too: Cursor fails open by default, which would quietly turn a guardrail off.
 */
function buildCursorGuardrailHooks(
  ctx: GuardrailsSyncContext,
  guardrails: GuardrailFrontmatter[],
): CursorHooksSection {
  const entries: CursorHookEntry[] = [];
  const claudeOnly = new Set<string>();
  for (const guardrail of guardrails) {
    if (guardrail.platforms && !(guardrail.platforms as string[]).includes('cursor')) continue;
    const command = buildGuardrailCommand(guardrail, CURSOR_HOOK_SCRIPT);
    if (!command) continue;
    const toolName = CURSOR_TOOL_NAMES[guardrail.trigger];
    const hookType = guardrail.hook_type ?? 'PreToolUse';
    if (!toolName || hookType !== 'PreToolUse') {
      claudeOnly.add(hookType === 'PreToolUse' ? guardrail.trigger : `${guardrail.trigger} (${hookType})`);
      continue;
    }
    entries.push({ command, matcher: `^${toolName}$`, failClosed: true });
  }

  if (!ctx.checkMode) {
    if (entries.length > 0) ctx.log(`Guardrails: ${entries.length} guardrail(s) -> .cursor/hooks.json`);
    if (claudeOnly.size > 0) {
      ctx.log(
        `Guardrails: no Cursor equivalent for ${[...claudeOnly].join(', ')}; enforced in Claude Code only`,
      );
    }
  }
  return entries.length > 0 ? { preToolUse: entries } : {};
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
  sourceDir: string,
  data: Record<string, unknown>,
  stackMap: StackMap,
): string | null {
  const issues = frontmatterStackIssues(data);
  if (issues.length > 0) {
    const msg = `guardrails/${file}: invalid stack range(s) ${issues.join(', ')} — fix the range; until then the guardrail is mis-gated`;
    ctx.results.warnings.push(msg);
    ctx.log(`  WARN: ${msg}`);
  }
  const constraint = resolveStacks(basename(file, '.md'), sourceDir, readFrontmatterStacks(data), stackMap);
  const result = matchStackConstraint(constraint, ctx.detectedStacks);
  for (const stack of result.lowConfidence) {
    const det = ctx.detectedStacks.get(stack);
    if (!det || ctx.warnedLowConfidence.has(stack)) continue;
    ctx.warnedLowConfidence.add(stack);
    const msg = describeLowConfidence(stack, det, `guardrails/${file}`);
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
    const command = buildGuardrailCommand(guardrail);
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
