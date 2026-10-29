import { join } from 'node:path';
import type { Platform } from '../types.js';
import { readIfExists } from '../utils/fs.js';
import { BUILTIN_MCP_SERVERS, parseLlmMcpServerList } from '../mcp/registry.js';
import type { McpServerConfig } from '../mcp/registry.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';

export interface AntigravitySyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

type McpServers = Record<string, Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads `llm/mcp.json` into resolved server configs; `null` when there is no manifest. */
function readManifest(sourceBase: string, recordError: (message: string) => void): McpServers | null {
  const raw = readIfExists(join(sourceBase, 'mcp.json'));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`antigravity mcp: failed to parse llm/mcp.json: ${message}`);
    return null;
  }

  const servers = isPlainObject(parsed) ? parsed.servers : undefined;
  if (!Array.isArray(servers)) return null;

  return toAntigravityServers(parseLlmMcpServerList(servers, BUILTIN_MCP_SERVERS).configs);
}

/**
 * Maps our internal MCP shape to Antigravity's: stdio is `command` / `args`, remote is `serverUrl`
 * (Streamable HTTP; Antigravity has no `type` or `httpUrl` field).
 */
function toAntigravityServers(configs: Record<string, McpServerConfig>): McpServers {
  const out: McpServers = {};
  for (const [id, cfg] of Object.entries(configs)) {
    if (cfg.url) {
      out[id] = { serverUrl: cfg.url };
    } else if (cfg.command) {
      out[id] = { command: cfg.command, ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}) };
    }
  }
  return out;
}

function parseConfig(raw: string | null): Record<string, unknown> | string {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : 'expected a JSON object';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Merges the `llm/mcp.json` servers into `.agents/mcp_config.json` under `mcpServers`. Each manifest
 * server's entry is replaced by name; servers the user added by hand, and every other key, are kept.
 * A server dropped from the manifest is not removed (sync cannot tell it from a hand-added one).
 * A file sync cannot parse is never overwritten.
 */
export function syncAntigravityMcp(
  ctx: AntigravitySyncContext,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes('antigravity')) return;

  const servers = readManifest(ctx.sourceBase, recordError);
  if (servers === null || Object.keys(servers).length === 0) return;

  const configPath = join(ctx.root, '.agents', 'mcp_config.json');
  const existing = parseConfig(readIfExists(configPath));
  if (typeof existing === 'string') {
    recordError(`.agents/mcp_config.json: ${existing}. Fix it so sync can merge the MCP servers.`);
    return;
  }
  const current = existing.mcpServers ?? {};
  if (!isPlainObject(current)) {
    recordError('.agents/mcp_config.json: "mcpServers" must be an object.');
    return;
  }

  const updated = { ...existing, mcpServers: { ...current, ...servers } };
  const content = `${JSON.stringify(updated, null, 2)}\n`;
  if (`${JSON.stringify(existing, null, 2)}\n` === content) return;

  commitPlannedWrite(ctx, configPath, content);
  if (!ctx.checkMode) {
    ctx.log(`Antigravity MCP: ${Object.keys(servers).length} server(s) merged -> .agents/mcp_config.json`);
  }
}
