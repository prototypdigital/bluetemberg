import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildCoverageReport, buildDetectReport, buildStacksList } from '../stacks/report.js';
import { resolveGithubToken } from '../stacks/github.js';
import { runScanOrg } from '../stacks/scan.js';

/**
 * First-party MCP server — exposes Bluetemberg's stack detection + coverage model as tools so any
 * agent can query version-correct guidance structurally (the read side of the `--json` flags, one
 * implementation, two surfaces). Read-only: it reports what the project uses and what guidance
 * exists, and never writes. The gated `scaffold_from_gap` tool belongs to the parked create-loop
 * (M7) and is intentionally absent.
 */

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export const STACKS_MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'bluetemberg_detect_stacks',
    description:
      "Detect the project's technology stacks and resolved versions, each with detection confidence " +
      'and coverage. Returns { detected, gaps, warnings }. Call once at session start to self-select ' +
      'version-correct guidance.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bluetemberg_query_coverage',
    description:
      'Ask whether version-correct guidance exists for a stack. Returns { query, result } with ' +
      '`known`, `covered`, the most-specific matched range, and — when uncovered — a `reason` ' +
      '(`version-uncovered` = guidance exists but not for this version; `no-coverage` = nothing ' +
      'targets this stack).',
    inputSchema: {
      type: 'object',
      properties: {
        stack: { type: 'string', description: 'Stack name, e.g. "payload" or "nextjs".' },
        version: { type: 'string', description: 'Optional version to check, e.g. "3.4.0".' },
      },
      required: ['stack'],
      additionalProperties: false,
    },
  },
  {
    name: 'bluetemberg_list_stacks',
    description:
      "List the live stack registry (catalog-declared ∪ detected) with each stack's covered ranges, " +
      'detected version, and origins.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bluetemberg_org_histogram',
    description:
      '[maintainer] Build a (stack, version) usage histogram vs catalog coverage. Accepts any ' +
      'combination of local roots, a GitHub org slug, or specific owner/repo pairs. Remote scanning ' +
      'reads GITHUB_TOKEN or GH_TOKEN from the MCP server process environment (never from tool ' +
      'args). Read-only. Returns { roots, scanned, empty, skipped, histogram, gaps } — `gaps` is ' +
      'the authoring priority list (uncovered buckets ranked by usage).',
    inputSchema: {
      type: 'object',
      properties: {
        roots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Local repo root directories (absolute or relative to the server cwd).',
        },
        org: {
          type: 'string',
          description: 'GitHub org slug — scan every non-fork, non-archived repo in this org.',
        },
        repos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific repos to scan remotely as "owner/repo" pairs.',
        },
        since: {
          type: 'number',
          description: 'Only scan repos pushed to within the last N days (org only).',
        },
      },
      additionalProperties: false,
    },
  },
];

/**
 * Run one stack tool by name against `root`. Pure (reads the project, returns data) so it can be
 * unit-tested without a transport. Throws on an unknown tool or a missing required argument.
 */
export async function callStacksTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'bluetemberg_detect_stacks':
      return buildDetectReport(root);
    case 'bluetemberg_list_stacks':
      return buildStacksList(root);
    case 'bluetemberg_query_coverage': {
      const stack = typeof args.stack === 'string' ? args.stack.trim() : '';
      if (!stack) throw new Error('bluetemberg_query_coverage requires a non-empty "stack" argument');
      const version =
        typeof args.version === 'string' && args.version.trim() ? args.version.trim() : undefined;
      return buildCoverageReport(root, stack, version);
    }
    case 'bluetemberg_org_histogram': {
      const rawRoots = Array.isArray(args.roots) ? args.roots : [];
      const roots = [
        ...new Set(rawRoots.filter((p): p is string => typeof p === 'string' && p.length > 0)),
      ].map((p) => resolve(root, p));
      const org = typeof args.org === 'string' && args.org.trim() ? args.org.trim() : undefined;
      const rawRepos = Array.isArray(args.repos) ? args.repos : [];
      const repos = rawRepos.filter((r): r is string => typeof r === 'string' && r.length > 0);
      if (roots.length === 0 && !org && repos.length === 0) {
        throw new Error('bluetemberg_org_histogram requires at least one of: roots, org, or repos');
      }
      const since = typeof args.since === 'number' && args.since > 0 ? args.since : undefined;
      const token = org || repos.length > 0 ? resolveGithubToken() : undefined;
      return runScanOrg(roots, {
        org,
        repos: repos.length > 0 ? repos : undefined,
        token,
        since,
        catalogRoot: root,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Build the MCP server with the stack tools wired to `root`. Transport-agnostic (see {@link serveStdio}). */
export function createStacksMcpServer(root: string, version: string): Server {
  const server = new Server({ name: 'bluetemberg', version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: STACKS_MCP_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const data = await callStacksTool(root, name, args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
}

/** Serve the stack tools over stdio. Resolves once connected; the transport keeps the process alive. */
export async function serveStdio(root: string, version: string): Promise<void> {
  const server = createStacksMcpServer(root, version);
  await server.connect(new StdioServerTransport());
}
