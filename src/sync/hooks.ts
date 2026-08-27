import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite, ensurePlannedDir } from './pipeline.js';

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

export function syncHooks(ctx: HooksSyncContext, recordError: (message: string) => void): void {
  if (!ctx.platforms.includes('cursor')) return;

  const manifestPath = join(ctx.sourceBase, 'hooks.json');
  if (!existsSync(manifestPath)) return;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`hooks.json: failed to parse: ${message}`);
    return;
  }

  const parsed = parseHooksManifest(raw);
  if (parsed === null) {
    recordError(
      'hooks.json: expected { "version"?: number, "hooks": { "<event>": [ { "command": "..." } ] } }',
    );
    return;
  }

  const outPath = join(ctx.root, '.cursor', 'hooks.json');
  const body = `${JSON.stringify({ version: parsed.version, hooks: parsed.hooks }, null, 2)}\n`;
  ensurePlannedDir(ctx, join(ctx.root, '.cursor'));
  commitPlannedWrite(ctx, outPath, body);

  if (!ctx.checkMode) {
    const eventCount = Object.keys(parsed.hooks).length;
    ctx.log(`Hooks: ${eventCount} event(s) from llm/hooks.json -> .cursor/hooks.json`);
  }
}
