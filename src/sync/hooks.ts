import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedDelete, commitPlannedWrite } from './pipeline.js';
import { isGuardrailHookCommand } from './guardrails.js';

export interface HooksSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

function isCommandHookEntry(value: unknown): value is { command: string } & Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const cmd = (value as { command?: unknown }).command;
  return typeof cmd === 'string' && cmd.length > 0;
}

/**
 * Validates Cursor-style hooks.json: { version?: number, hooks: { [event]: { command }[] } }
 */
export function parseHooksManifest(raw: unknown): { version: number; hooks: CursorHooksSection } | null {
  if (raw === null || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  let version = 1;
  if (obj.version !== undefined) {
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
      return null;
    }
    version = obj.version;
  }

  const hooksRaw = obj.hooks;
  if (hooksRaw === null || typeof hooksRaw !== 'object' || Array.isArray(hooksRaw)) {
    return null;
  }

  const hooks: CursorHooksSection = {};
  for (const [event, list] of Object.entries(hooksRaw as Record<string, unknown>)) {
    if (!Array.isArray(list)) return null;
    const entries: CursorHookEntry[] = [];
    for (const item of list) {
      if (!isCommandHookEntry(item)) return null;
      entries.push(toCursorHookEntry(item));
    }
    hooks[event] = entries;
  }

  return { version, hooks };
}

/** A Cursor hook entry as written to `.cursor/hooks.json`. */
export interface CursorHookEntry {
  command: string;
  matcher?: string;
  timeout?: number;
  failClosed?: boolean;
}

/** Keeps the per-entry options Cursor documents; anything else is dropped. */
function toCursorHookEntry(item: { command: string } & Record<string, unknown>): CursorHookEntry {
  const entry: CursorHookEntry = { command: item.command };
  if (typeof item.matcher === 'string') entry.matcher = item.matcher;
  if (typeof item.timeout === 'number') entry.timeout = item.timeout;
  if (typeof item.failClosed === 'boolean') entry.failClosed = item.failClosed;
  return entry;
}

/** Entries grouped by Cursor event name (`preToolUse`, `beforeShellExecution`, …). */
export type CursorHooksSection = Record<string, CursorHookEntry[]>;

type ManifestResult =
  { status: 'absent' } | { status: 'invalid' } | { status: 'ok'; version: number; hooks: CursorHooksSection };

function loadManifest(ctx: HooksSyncContext, recordError: (message: string) => void): ManifestResult {
  const manifestPath = join(ctx.sourceBase, 'hooks.json');
  if (!existsSync(manifestPath)) return { status: 'absent' };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`hooks.json: failed to parse: ${message}`);
    return { status: 'invalid' };
  }

  const parsed = parseHooksManifest(raw);
  if (parsed === null) {
    recordError(
      'hooks.json: expected { "version"?: number, "hooks": { "<event>": [ { "command": "..." } ] } }',
    );
    return { status: 'invalid' };
  }
  return { status: 'ok', ...parsed };
}

/** Per event: guardrail entries first, then the entries the file already owns. */
function mergeSections(
  guardrail: CursorHooksSection | null,
  rest: Record<string, readonly unknown[]> | null,
): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = {};
  const events = new Set([...Object.keys(guardrail ?? {}), ...Object.keys(rest ?? {})]);
  for (const event of events) {
    const entries = [...(guardrail?.[event] ?? []), ...(rest?.[event] ?? [])];
    if (entries.length > 0) merged[event] = entries;
  }
  return merged;
}

type ExistingHooks =
  | { status: 'absent' }
  | { status: 'invalid' }
  | {
      status: 'ok';
      file: Record<string, unknown>;
      handWritten: Record<string, unknown[]>;
      generated: number;
    };

/**
 * Reads the current `.cursor/hooks.json` and splits its entries into those an earlier sync
 * generated for guardrails (recognized by their command) and everything else, which a person wrote.
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
  const hooks = file.hooks ?? {};
  if (!isPlainObject(hooks)) return { status: 'invalid' };

  let generated = 0;
  const handWritten: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) return { status: 'invalid' };
    const survivors = entries.filter((entry) => {
      const command = isPlainObject(entry) ? entry.command : undefined;
      const isGenerated = typeof command === 'string' && isGuardrailHookCommand(command);
      if (isGenerated) generated++;
      return !isGenerated;
    });
    if (survivors.length > 0) handWritten[event] = survivors;
  }
  return { status: 'ok', file, handWritten, generated };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Without `llm/hooks.json` the file belongs to the person who wrote it: guardrail entries are
 * placed ahead of the hand-written ones, which are kept as they are. Entries an earlier sync
 * generated are replaced, or removed once their source is gone. Never creates the file for nothing,
 * and deletes it when only the guardrail entries kept it alive.
 */
function syncGuardrailOnlyHooks(
  ctx: HooksSyncContext,
  outPath: string,
  guardrailHooks: CursorHooksSection | null,
  recordError: (message: string) => void,
): void {
  const hasGuardrailEntries = Object.keys(guardrailHooks ?? {}).length > 0;
  const existing = readExistingHooks(outPath);
  if (existing.status === 'invalid') {
    if (hasGuardrailEntries) {
      recordError(
        '.cursor/hooks.json: not a valid hooks file, so guardrail hooks were not added; fix or remove it',
      );
    }
    return;
  }
  if (existing.status === 'absent') {
    if (hasGuardrailEntries)
      commitPlannedWrite(ctx, outPath, renderHooksFile({ version: 1 }, guardrailHooks));
    return;
  }
  if (!hasGuardrailEntries && existing.generated === 0) return;

  const hooks = mergeSections(guardrailHooks, existing.handWritten);
  const otherKeys = Object.keys(existing.file).filter((key) => key !== 'version' && key !== 'hooks');
  if (Object.keys(hooks).length === 0 && otherKeys.length === 0) {
    commitPlannedDelete(ctx, outPath);
  } else {
    commitPlannedWrite(ctx, outPath, renderHooksFile(existing.file, hooks));
  }
  if (!ctx.checkMode && !hasGuardrailEntries) {
    ctx.log(`Hooks: removed ${existing.generated} guardrail hook(s) whose source is gone`);
  }
}

function renderHooksFile(
  base: Record<string, unknown>,
  hooks: Record<string, readonly unknown[]> | null,
): string {
  return `${JSON.stringify({ ...base, version: base.version ?? 1, hooks: hooks ?? {} }, null, 2)}\n`;
}

/**
 * Single writer of `.cursor/hooks.json`. Composes guardrail entries (computed by `syncGuardrails`)
 * with the project's `llm/hooks.json`. When the manifest exists the file is bluetemberg-owned and
 * written whole, guardrail entries first; without it, guardrail entries are merged into the file
 * and hand-written entries survive (see {@link syncGuardrailOnlyHooks}). An invalid manifest writes
 * nothing, so a typo cannot drop working hooks.
 */
export function syncHooks(
  ctx: HooksSyncContext,
  guardrailHooks: CursorHooksSection | null,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes('cursor')) return;

  const outPath = join(ctx.root, '.cursor', 'hooks.json');
  const manifest = loadManifest(ctx, recordError);
  if (manifest.status === 'invalid') return;
  if (manifest.status === 'absent') {
    syncGuardrailOnlyHooks(ctx, outPath, guardrailHooks, recordError);
    return;
  }

  const hooks = mergeSections(guardrailHooks, manifest.hooks);
  commitPlannedWrite(ctx, outPath, renderHooksFile({ version: manifest.version }, hooks));

  if (!ctx.checkMode) {
    ctx.log(
      `Hooks: ${Object.keys(manifest.hooks).length} event(s) from llm/hooks.json -> .cursor/hooks.json`,
    );
  }
}
