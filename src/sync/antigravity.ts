import type { McpServerConfig } from '../mcp/registry.js';

/** Antigravity's MCP config, merged by `syncMcp` (see `src/sync/mcp.ts`). */
export const ANTIGRAVITY_MCP_FILE = '.agents/mcp_config.json';

/** Fields of an Antigravity server entry the manifest defines; any other field a person added is kept. */
export const ANTIGRAVITY_MANAGED_FIELDS: ReadonlySet<string> = new Set(['command', 'args', 'serverUrl']);

/**
 * Maps our internal MCP shape to Antigravity's: stdio is `command` / `args`, remote is `serverUrl`
 * (Streamable HTTP; Antigravity has no `type` or `httpUrl` field).
 */
export function toAntigravityServers(
  configs: Record<string, McpServerConfig>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, cfg] of Object.entries(configs)) {
    if (cfg.url) {
      out[id] = { serverUrl: cfg.url };
    } else if (cfg.command) {
      out[id] = { command: cfg.command, ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}) };
    }
  }
  return out;
}
