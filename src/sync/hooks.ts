import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite } from './pipeline.js';
import { isGuardrailHookCommand } from './guardrails.js';

export interface HooksSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

function isCommandHookEntry(value: unknown): value is { command: string } {
  if (value === null || typeof value !== 'object') return false;
  const cmd = (value as { command?: unknown }).command;
  return typeof cmd === 'string' && cmd.length > 0;
}

/**
 * Validates Cursor-style hooks.json: { version?: number, hooks: { [event]: { command }[] } }
 */
export function parseHooksManifest(
  raw: unknown,
): { version: number; hooks: Record<string, { command: string }[]> } | null {
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

  const hooks: Record<string, { command: string }[]> = {};
  for (const [event, list] of Object.entries(hooksRaw as Record<string, unknown>)) {
    if (!Array.isArray(list)) return null;
    const entries: { command: string }[] = [];
    for (const item of list) {
      if (!isCommandHookEntry(item)) return null;
      entries.push({ command: item.command });
    }
    hooks[event] = entries;
  }

  return { version, hooks };
}

/** A Cursor hook entry as written to `.cursor/hooks.json`. */
export interface CursorHookEntry {
  command: string;
  matcher?: string;
  failClosed?: boolean;
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

/** Per event: guardrail entries first, then the project's own `llm/hooks.json` entries. */
function mergeSections(
  guardrail: CursorHooksSection | null,
  project: CursorHooksSection | null,
): CursorHooksSection {
  const merged: CursorHooksSection = {};
  const events = new Set([...Object.keys(guardrail ?? {}), ...Object.keys(project ?? {})]);
  for (const event of events) {
    const entries = [...(guardrail?.[event] ?? []), ...(project?.[event] ?? [])];
    if (entries.length > 0) merged[event] = entries;
  }
  return merged;
}

/**
 * With no guardrail source and no manifest left, guardrail entries an earlier sync wrote are
 * orphans that still run on every tool call. Remove exactly those (recognized by their generated
 * command) and keep anything else; never creates the file.
 */
function removeOrphanedGuardrailHooks(ctx: HooksSyncContext, outPath: string): void {
  if (!existsSync(outPath)) return;
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    return;
  }
  if (!isPlainObject(existing) || !isPlainObject(existing.hooks)) return;

  let removed = 0;
  const kept: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(existing.hooks)) {
    if (!Array.isArray(entries)) continue;
    const survivors = entries.filter((entry) => {
      const command = isPlainObject(entry) ? entry.command : undefined;
      const generated = typeof command === 'string' && isGuardrailHookCommand(command);
      if (generated) removed++;
      return !generated;
    });
    if (survivors.length > 0) kept[event] = survivors;
  }
  if (removed === 0) return;

  commitPlannedWrite(ctx, outPath, `${JSON.stringify({ ...existing, hooks: kept }, null, 2)}\n`);
  if (!ctx.checkMode) ctx.log(`Hooks: removed ${removed} guardrail hook(s) whose source is gone`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Single writer of `.cursor/hooks.json`. Composes guardrail entries (computed by `syncGuardrails`)
 * with the project's `llm/hooks.json`. When either source exists the file is bluetemberg-owned and
 * written whole; when neither does, only orphaned guardrail entries are removed. An invalid manifest
 * writes nothing, so a typo cannot drop working hooks.
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
  if (manifest.status === 'absent' && guardrailHooks === null) {
    removeOrphanedGuardrailHooks(ctx, outPath);
    return;
  }

  const project = manifest.status === 'ok' ? manifest.hooks : null;
  const version = manifest.status === 'ok' ? manifest.version : 1;
  const hooks = mergeSections(guardrailHooks, project);
  // Guardrails exist but none compile for Cursor (e.g. every trigger is Claude-only): never create
  // an empty file, just take out entries an earlier sync generated.
  if (project === null && Object.keys(hooks).length === 0) {
    removeOrphanedGuardrailHooks(ctx, outPath);
    return;
  }
  commitPlannedWrite(ctx, outPath, `${JSON.stringify({ version, hooks }, null, 2)}\n`);

  if (!ctx.checkMode && project !== null) {
    ctx.log(`Hooks: ${Object.keys(project).length} event(s) from llm/hooks.json -> .cursor/hooks.json`);
  }
}
