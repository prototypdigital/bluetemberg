export interface McpServerConfig {
  command?: string;
  args?: string[];
  type: string;
  url?: string;
}

/** Preset MCP servers available during init and resolvable from `llm/mcp.json`. */
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

export function resolveMcpServerIds(
  ids: readonly string[],
  registry: Record<string, McpServerConfig>,
): { configs: Record<string, McpServerConfig>; unknownIds: string[] } {
  const configs: Record<string, McpServerConfig> = {};
  const unknownIds: string[] = [];

  for (const id of ids) {
    const entry = registry[id];
    if (entry) {
      configs[id] = entry;
    } else {
      unknownIds.push(id);
    }
  }

  return { configs, unknownIds };
}
