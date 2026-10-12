import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';

export interface ClaudeSettingsSyncContext extends SyncSink {
  /** `owner/repo` shorthand for the remote marketplace. */
  remote: string;
  /** Marketplace `name` from the generated `.claude-plugin/marketplace.json`. */
  marketplaceName: string;
  /** Names of the plugins published in that marketplace. */
  plugins: string[];
}

type MarketplaceEntries = Record<string, unknown>;

function readExistingSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (isPlainObject(parsed)) return parsed;
  } catch {
    // corrupt file — start fresh
  }
  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const OWNER_REPO_RE = /^[^/]+\/[^/]+$/;

function githubEntry(repo: string): { source: { source: 'github'; repo: string } } {
  return { source: { source: 'github', repo } };
}

/**
 * Converts the legacy `extraKnownMarketplaces: ["owner/repo"]` form, which Claude Code rejects,
 * into its object form. `remote` is skipped (the caller writes it under our marketplace name);
 * any other `owner/repo` entry is keyed by its repo segment, since its real name is unknown.
 */
function migrateLegacyArray(
  legacy: unknown[],
  ctx: ClaudeSettingsSyncContext,
  recordWarning: (message: string) => void,
): MarketplaceEntries {
  const entries: MarketplaceEntries = {};
  for (const item of legacy) {
    if (item === ctx.remote) continue;
    const repo = typeof item === 'string' && OWNER_REPO_RE.test(item) ? item : undefined;
    const name = repo?.split('/')[1];
    if (!repo || !name || name === ctx.marketplaceName || Object.hasOwn(entries, name)) {
      if (!ctx.checkMode) {
        recordWarning(`Claude settings: dropped legacy extraKnownMarketplaces entry ${JSON.stringify(item)}`);
      }
      continue;
    }
    entries[name] = githubEntry(repo);
  }
  return entries;
}

function readMarketplaces(
  existing: Record<string, unknown>,
  ctx: ClaudeSettingsSyncContext,
  recordWarning: (message: string) => void,
): MarketplaceEntries {
  const value = existing.extraKnownMarketplaces;
  if (Array.isArray(value)) return migrateLegacyArray(value, ctx, recordWarning);
  return isPlainObject(value) ? { ...value } : {};
}

/**
 * Enables each published plugin, keeping any existing value so a teammate's `false` opt-out
 * survives re-sync, and drops `true` entries for plugins this marketplace no longer publishes.
 */
function mergeEnabledPlugins(existing: unknown, ctx: ClaudeSettingsSyncContext): Record<string, unknown> {
  const suffix = `@${ctx.marketplaceName}`;
  const published = new Set(ctx.plugins.map((plugin) => `${plugin}${suffix}`));
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(isPlainObject(existing) ? existing : {})) {
    if (key.endsWith(suffix) && value === true && !published.has(key)) continue;
    merged[key] = value;
  }
  for (const key of published) merged[key] ??= true;
  return merged;
}

/**
 * Merges the remote marketplace into `.claude/settings.json` under `extraKnownMarketplaces`
 * (keyed by marketplace name) and enables its plugins under `enabledPlugins`. Other
 * marketplaces are preserved; our entry keeps its extra keys (e.g. `autoUpdate`) but its
 * `source` always tracks `remote` (other `source` fields, such as a pinned `ref`, are kept).
 */
export function syncClaudeSettings(
  ctx: ClaudeSettingsSyncContext,
  recordWarning: (message: string) => void,
): void {
  if (!OWNER_REPO_RE.test(ctx.remote)) {
    ctx.log(`Claude settings: skipping — remote "${ctx.remote}" is not in owner/repo format`);
    return;
  }
  const settingsPath = join(ctx.root, '.claude', 'settings.json');
  const existing = readExistingSettings(settingsPath);

  const marketplaces = readMarketplaces(existing, ctx, recordWarning);
  const current = marketplaces[ctx.marketplaceName];
  const previous = isPlainObject(current) ? current : {};
  marketplaces[ctx.marketplaceName] = {
    ...previous,
    source: {
      ...(isPlainObject(previous.source) ? previous.source : {}),
      ...githubEntry(ctx.remote).source,
    },
  };
  const enabledPlugins = mergeEnabledPlugins(existing.enabledPlugins, ctx);

  const updated: Record<string, unknown> = {
    ...existing,
    extraKnownMarketplaces: marketplaces,
    ...(existing.enabledPlugins !== undefined || Object.keys(enabledPlugins).length > 0
      ? { enabledPlugins }
      : {}),
  };
  const content = JSON.stringify(updated, null, 2) + '\n';
  if (JSON.stringify(existing, null, 2) + '\n' === content) return;

  commitPlannedWrite(ctx, settingsPath, content);

  if (!ctx.checkMode) {
    ctx.log(`Claude settings: registered marketplace "${ctx.marketplaceName}" (${ctx.remote})`);
    ctx.log(`  -> .claude/settings.json`);
  }
}
