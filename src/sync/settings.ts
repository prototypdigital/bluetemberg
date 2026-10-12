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
 * into its object form. The entry for `remote` is keyed by our marketplace name; any other
 * `owner/repo` entry is keyed by its repo segment, since its real marketplace name is unknown.
 */
function migrateLegacyArray(legacy: unknown[], ctx: ClaudeSettingsSyncContext): MarketplaceEntries {
  const entries: MarketplaceEntries = {};
  for (const item of legacy) {
    if (typeof item !== 'string' || !OWNER_REPO_RE.test(item)) {
      ctx.log(`Claude settings: dropping legacy extraKnownMarketplaces entry ${JSON.stringify(item)}`);
      continue;
    }
    const name = item === ctx.remote ? ctx.marketplaceName : item.split('/')[1];
    entries[name] = githubEntry(item);
  }
  return entries;
}

function readMarketplaces(
  existing: Record<string, unknown>,
  ctx: ClaudeSettingsSyncContext,
): MarketplaceEntries {
  const value = existing.extraKnownMarketplaces;
  if (Array.isArray(value)) return migrateLegacyArray(value, ctx);
  return isPlainObject(value) ? { ...value } : {};
}

/**
 * Merges the remote marketplace into `.claude/settings.json` under `extraKnownMarketplaces`
 * (keyed by marketplace name) and enables each of its plugins under `enabledPlugins`.
 * Existing entries are never overwritten, so a teammate's `false` opt-out survives re-sync.
 */
export function syncClaudeSettings(ctx: ClaudeSettingsSyncContext): void {
  if (!OWNER_REPO_RE.test(ctx.remote)) {
    ctx.log(`Claude settings: skipping — remote "${ctx.remote}" is not in owner/repo format`);
    return;
  }
  const settingsPath = join(ctx.root, '.claude', 'settings.json');
  const existing = readExistingSettings(settingsPath);

  const marketplaces = readMarketplaces(existing, ctx);
  marketplaces[ctx.marketplaceName] ??= githubEntry(ctx.remote);

  const enabledPlugins = isPlainObject(existing.enabledPlugins) ? { ...existing.enabledPlugins } : {};
  for (const plugin of ctx.plugins) {
    enabledPlugins[`${plugin}@${ctx.marketplaceName}`] ??= true;
  }

  const updated: Record<string, unknown> = {
    ...existing,
    extraKnownMarketplaces: marketplaces,
    ...(Object.keys(enabledPlugins).length > 0 ? { enabledPlugins } : {}),
  };
  const content = JSON.stringify(updated, null, 2) + '\n';
  if (existsSync(settingsPath) && JSON.stringify(existing, null, 2) + '\n' === content) return;

  commitPlannedWrite(ctx, settingsPath, content);

  if (!ctx.checkMode) {
    ctx.log(`Claude settings: registered marketplace "${ctx.marketplaceName}" (${ctx.remote})`);
    ctx.log(`  -> .claude/settings.json`);
  }
}
