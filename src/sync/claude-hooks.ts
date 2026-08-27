import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import { commitPlannedWrite, ensurePlannedDir, type SyncSink } from './pipeline.js';

/** Source manifest filename, read exclusively from the project's own source dir (`llm/`). */
export const CLAUDE_HOOKS_MANIFEST = 'hooks.claude.json';

/**
 * Events a project hook manifest may register. Deliberately a whitelist: an event outside this
 * list is a sync error, so a typo (or a new event we have not reviewed) never silently no-ops
 * or silently activates.
 */
export const CLAUDE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
] as const;

export interface ClaudeHookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface ClaudeHookMatcherEntry {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}

/** Hook entries grouped by event name — the exact shape of the `hooks` key in `.claude/settings.json`. */
export type ClaudeHooksSection = Record<string, ClaudeHookMatcherEntry[]>;

export interface ClaudeHooksSyncContext extends SyncSink {
  /** The project's own source dir (`<root>/llm`) — the only dir hooks are honored from. */
  sourceBase: string;
  /** All source dirs in priority order: local first, then `extends`, packs, external sources. */
  sourceDirs: string[];
  /** Count of `extends` dirs (for origin labels in warnings). */
  extendedCount: number;
  /** Count of registry-pack dirs. */
  packCount: number;
  platforms: readonly Platform[];
}

const EXPECTED_SHAPE =
  'expected { "hooks": { "<Event>": [ { "matcher"?: string, "hooks": [ { "type": "command", "command": string, "timeout"?: number } ] } ] } }';

type ManifestResult =
  { status: 'absent' } | { status: 'invalid' } | { status: 'ok'; hooks: ClaudeHooksSection };

function isWhitelistedEvent(event: string): boolean {
  return (CLAUDE_HOOK_EVENTS as readonly string[]).includes(event);
}

/** Parse one `hooks` array item into a normalized command hook, or return an error string. */
function parseCommandHook(raw: unknown, label: string): ClaudeHookCommand | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `${label}: each hook must be an object — ${EXPECTED_SHAPE}`;
  }
  const hook = raw as Record<string, unknown>;
  if (hook.type !== 'command') {
    return `${label}: only "type": "command" hooks are supported (got ${JSON.stringify(hook.type)})`;
  }
  if (typeof hook.command !== 'string' || hook.command.trim().length === 0) {
    return `${label}: "command" must be a non-empty string`;
  }
  const result: ClaudeHookCommand = { type: 'command', command: hook.command };
  if (hook.timeout !== undefined) {
    if (typeof hook.timeout !== 'number' || !Number.isFinite(hook.timeout) || hook.timeout <= 0) {
      return `${label}: "timeout" must be a positive number`;
    }
    result.timeout = hook.timeout;
  }
  return result;
}

/** Parse one matcher entry (`{ matcher?, hooks: [...] }`), or return an error string. */
function parseMatcherEntry(raw: unknown, label: string): ClaudeHookMatcherEntry | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `${label}: each entry must be an object — ${EXPECTED_SHAPE}`;
  }
  const entry = raw as Record<string, unknown>;
  if (entry.matcher !== undefined && typeof entry.matcher !== 'string') {
    return `${label}: "matcher" must be a string when present`;
  }
  if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
    return `${label}: "hooks" must be a non-empty array`;
  }

  const hooks: ClaudeHookCommand[] = [];
  for (let i = 0; i < entry.hooks.length; i++) {
    const parsed = parseCommandHook(entry.hooks[i], `${label}.hooks[${i}]`);
    if (typeof parsed === 'string') return parsed;
    hooks.push(parsed);
  }

  const result: ClaudeHookMatcherEntry = { hooks };
  if (entry.matcher !== undefined) result.matcher = entry.matcher;
  return result;
}

/**
 * Validate and normalize a parsed `hooks.claude.json`. Returns the hooks section, or an error
 * string describing the first violation. Unknown top-level keys are ignored (forward
 * compatibility); unknown events are not — see {@link CLAUDE_HOOK_EVENTS}.
 */
export function parseClaudeHooksManifest(raw: unknown): ClaudeHooksSection | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return EXPECTED_SHAPE;
  }
  const hooksRaw = (raw as Record<string, unknown>).hooks;
  if (!hooksRaw || typeof hooksRaw !== 'object' || Array.isArray(hooksRaw)) {
    return EXPECTED_SHAPE;
  }

  const events = Object.keys(hooksRaw as Record<string, unknown>);
  const unknown = events.filter((e) => !isWhitelistedEvent(e));
  if (unknown.length > 0) {
    return `unsupported event(s): ${unknown.join(', ')} — allowed events: ${CLAUDE_HOOK_EVENTS.join(', ')}`;
  }

  const section: ClaudeHooksSection = {};
  for (const [event, list] of Object.entries(hooksRaw as Record<string, unknown>)) {
    if (!Array.isArray(list)) {
      return `"hooks".${event} must be an array of entries`;
    }
    const entries: ClaudeHookMatcherEntry[] = [];
    for (let i = 0; i < list.length; i++) {
      const parsed = parseMatcherEntry(list[i], `${event}[${i}]`);
      if (typeof parsed === 'string') return parsed;
      entries.push(parsed);
    }
    section[event] = entries;
  }

  return section;
}

/** Origin label for a non-local source dir index (mirrors the sync engine's verbose labels). */
function nonLocalSourceLabel(ctx: ClaudeHooksSyncContext, index: number): string {
  const extendsEnd = 1 + ctx.extendedCount;
  if (index < extendsEnd) return `extends[${index - 1}]`;
  const packEnd = extendsEnd + ctx.packCount;
  if (index < packEnd) return `pack[${index - extendsEnd}]`;
  return `external[${index - packEnd}]`;
}

/**
 * SECURITY BOUNDARY: `hooks.claude.json` is honored ONLY from the project's own source dir.
 *
 * Command hooks are arbitrary shell executed by Claude Code. Letting an installed pack or an
 * `extends` source contribute them would reintroduce exactly the remote-code-execution vector
 * that #126 eliminated — a `bluetemberg sync` after `pack install` would silently wire
 * third-party shell into the user's session. Guardrails remain the only pack-shippable hook
 * surface (declarative, compiled into a fixed injection-safe script). Any non-local manifest
 * is skipped with a warning naming its source so the omission is visible, never silent.
 */
function warnNonLocalManifests(ctx: ClaudeHooksSyncContext, recordWarning: (message: string) => void): void {
  for (let i = 1; i < ctx.sourceDirs.length; i++) {
    const manifestPath = join(ctx.sourceDirs[i], CLAUDE_HOOKS_MANIFEST);
    if (!existsSync(manifestPath)) continue;
    recordWarning(
      `${CLAUDE_HOOKS_MANIFEST}: skipped ${nonLocalSourceLabel(ctx, i)} manifest at ${manifestPath} — Claude command hooks are honored only from the project's own source directory; packs and extended sources cannot ship shell hooks`,
    );
  }
}

/** Read + validate the project-local manifest. Absent, invalid, and valid are distinct outcomes. */
function loadProjectHooks(
  ctx: ClaudeHooksSyncContext,
  recordError: (message: string) => void,
): ManifestResult {
  const manifestPath = join(ctx.sourceBase, CLAUDE_HOOKS_MANIFEST);
  if (!existsSync(manifestPath)) return { status: 'absent' };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`${CLAUDE_HOOKS_MANIFEST}: failed to parse: ${message}`);
    return { status: 'invalid' };
  }

  const parsed = parseClaudeHooksManifest(raw);
  if (typeof parsed === 'string') {
    recordError(`${CLAUDE_HOOKS_MANIFEST}: ${parsed}`);
    return { status: 'invalid' };
  }
  return { status: 'ok', hooks: parsed };
}

/**
 * Deterministic event order: whitelisted events in their canonical order first, then any other
 * events (guardrail `hook_type` is free-form frontmatter) sorted alphabetically.
 */
function orderedEvents(...sections: (ClaudeHooksSection | null)[]): string[] {
  const present = new Set<string>();
  for (const section of sections) {
    for (const event of Object.keys(section ?? {})) present.add(event);
  }
  const known = CLAUDE_HOOK_EVENTS.filter((e) => present.has(e));
  const other = [...present].filter((e) => !isWhitelistedEvent(e)).sort();
  return [...known, ...other];
}

/** Per event: guardrail-generated entries first, then project manifest entries. */
function mergeHookSections(
  guardrailHooks: ClaudeHooksSection | null,
  projectHooks: ClaudeHooksSection | null,
): ClaudeHooksSection {
  const merged: ClaudeHooksSection = {};
  for (const event of orderedEvents(guardrailHooks, projectHooks)) {
    const entries = [...(guardrailHooks?.[event] ?? []), ...(projectHooks?.[event] ?? [])];
    if (entries.length > 0) merged[event] = entries;
  }
  return merged;
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
 * Remove the bluetemberg-owned `hooks` key from `.claude/settings.json`, preserving every other
 * key. No-op when the file or the key is absent — a project that never had synced hooks is never
 * given an empty settings file.
 */
function clearManagedHooks(ctx: ClaudeHooksSyncContext): void {
  const settingsPath = join(ctx.root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;
  const existing = readExistingSettings(settingsPath);
  if (!Object.prototype.hasOwnProperty.call(existing, 'hooks')) return;

  const cleared = { ...existing };
  delete cleared.hooks;
  commitPlannedWrite(ctx, settingsPath, JSON.stringify(cleared, null, 2) + '\n');
  if (!ctx.checkMode) {
    ctx.log('Claude hooks: cleared previously managed hooks (no applicable sources)');
  }
}

/**
 * Single writer of the `hooks` key in `.claude/settings.json`. Composes guardrail-generated
 * entries (computed by `syncGuardrails`) with the project's `llm/hooks.claude.json`.
 *
 * Precedence contract for the `hooks` key:
 *   1. When either source exists (guardrail files or a local `hooks.claude.json`), the key is
 *      bluetemberg-owned: final hooks = guardrail entries + project manifest entries,
 *      deterministically ordered (guardrail entries first within a shared event). Hand-written
 *      entries in the key are overwritten.
 *   2. When neither source exists, the key is never touched — hand-written hooks survive.
 *   3. When sources exist but contribute nothing (e.g. every guardrail version-filtered out,
 *      manifest with zero events), a previously managed key is cleared rather than left stale.
 *   4. When the manifest exists but is invalid, nothing is written at all: the error is recorded
 *      and the previous state is left intact, so a typo cannot silently drop working hooks.
 *
 * All other keys in `settings.json` (e.g. `extraKnownMarketplaces`) are always preserved.
 */
export function syncClaudeHooks(
  ctx: ClaudeHooksSyncContext,
  guardrailHooks: ClaudeHooksSection | null,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): void {
  if (!ctx.platforms.includes('claude')) return;

  warnNonLocalManifests(ctx, recordWarning);

  const manifest = loadProjectHooks(ctx, recordError);
  if (manifest.status === 'invalid') return;

  const projectHooks = manifest.status === 'ok' ? manifest.hooks : null;
  if (guardrailHooks === null && projectHooks === null) return;

  const combined = mergeHookSections(guardrailHooks, projectHooks);
  if (Object.keys(combined).length === 0) {
    clearManagedHooks(ctx);
    return;
  }

  const claudeDir = join(ctx.root, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  const existing = readExistingSettings(settingsPath);
  const updated: Record<string, unknown> = { ...existing, hooks: combined };

  ensurePlannedDir(ctx, claudeDir);
  commitPlannedWrite(ctx, settingsPath, JSON.stringify(updated, null, 2) + '\n');

  if (!ctx.checkMode && projectHooks !== null) {
    const eventCount = Object.keys(projectHooks).length;
    ctx.log(
      `Claude hooks: ${eventCount} event(s) from llm/${CLAUDE_HOOKS_MANIFEST} -> .claude/settings.json`,
    );
  }
}
