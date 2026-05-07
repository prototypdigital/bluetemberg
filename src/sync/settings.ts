import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';

export interface ClaudeSettingsSyncContext extends SyncSink {
  /** `owner/repo` shorthand for the remote marketplace. */
  remote: string;
}

function readExistingSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // corrupt file — start fresh
  }
  return {};
}

/**
 * Merges `remote` into `.claude/settings.json` under `extraKnownMarketplaces`.
 * Existing settings are preserved; the remote entry is added if not already present.
 */
export function syncClaudeSettings(ctx: ClaudeSettingsSyncContext): void {
  const claudeDir = join(ctx.root, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  const existing = readExistingSettings(settingsPath);
  const current: string[] = Array.isArray(existing.extraKnownMarketplaces)
    ? (existing.extraKnownMarketplaces as string[])
    : [];

  if (current.includes(ctx.remote)) return;

  const updated: Record<string, unknown> = {
    ...existing,
    extraKnownMarketplaces: [...current, ctx.remote],
  };

  ensureDir(claudeDir);
  commitPlannedWrite(ctx, settingsPath, JSON.stringify(updated, null, 2) + '\n');

  if (!ctx.checkMode) {
    ctx.log(`Claude settings: added ${ctx.remote} to extraKnownMarketplaces`);
    ctx.log(`  -> .claude/settings.json`);
  }
}
