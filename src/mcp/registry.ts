export interface McpServerConfig {
  command?: string;
  args?: string[];
  type: string;
  url?: string;
}

/**
 * Built-in MCP preset ids for `llm/mcp.json` and `bluetemberg init`.
 * These are convenience defaults: vendors may change URLs, packages, or flags; pin versions in
 * your manifest or use **inline** `servers` entries (see `parseLlmMcpServerList`) without
 * waiting for a Bluetemberg release.
 */
export const BUILTIN_MCP_SERVERS: Record<string, McpServerConfig> = {
  interactive: {
    command: 'npx',
    args: ['-y', '@rawwee/interactive-mcp', '-t', '1200', '--disable-tools', 'message_complete_notification'],
    type: 'stdio',
  },
  context7: {
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    type: 'stdio',
  },
  figma: {
    type: 'http',
    url: 'https://mcp.figma.com/mcp',
  },
  github: {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
  },
};

/**
 * Parses `llm/mcp.json` → `servers` array entries into a map keyed by server id.
 * Each entry may be a **preset id** string (resolved against `registry`) or an **inline object**
 * `{ "id", "type", ... }` that does not require a built-in preset.
 */
export function parseLlmMcpServerList(
  servers: readonly unknown[],
  registry: Record<string, McpServerConfig>,
): { configs: Record<string, McpServerConfig>; errors: string[] } {
  const errors: string[] = [];
  const configs: Record<string, McpServerConfig> = {};

  for (let i = 0; i < servers.length; i++) {
    const entry = servers[i];

    if (typeof entry === 'string') {
      if (entry.length === 0) {
        errors.push(`servers[${i}]: empty string is not a valid preset id`);
        continue;
      }
      const preset = registry[entry];
      if (!preset) {
        errors.push(`unknown server id "${entry}" (not in built-in registry)`);
        continue;
      }
      if (configs[entry] !== undefined) {
        errors.push(`duplicate server id "${entry}"`);
        continue;
      }
      configs[entry] = preset;
      continue;
    }

    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const id = obj.id;
      if (typeof id !== 'string' || id.length === 0) {
        errors.push(`servers[${i}]: inline object must have non-empty string "id"`);
        continue;
      }
      const type = obj.type;
      if (typeof type !== 'string' || type.length === 0) {
        errors.push(`servers[${i}]: inline object must have non-empty string "type"`);
        continue;
      }
      if (configs[id] !== undefined) {
        errors.push(`duplicate server id "${id}"`);
        continue;
      }
      const config: McpServerConfig = { type };
      if (typeof obj.command === 'string') {
        config.command = obj.command;
      }
      if (Array.isArray(obj.args) && obj.args.every((a) => typeof a === 'string')) {
        config.args = obj.args;
      }
      if (typeof obj.url === 'string') {
        config.url = obj.url;
      }
      configs[id] = config;
      continue;
    }

    errors.push(
      `servers[${i}]: expected a string (preset id) or an object with "id", "type", and optional "command", "args", "url"`,
    );
  }

  return { configs, errors };
}
