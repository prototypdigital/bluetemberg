import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import { BUILTIN_MCP_SERVERS, parseLlmMcpServerList } from '../mcp/registry.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite, ensurePlannedDir } from './pipeline.js';

export interface McpSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

export function syncMcp(ctx: McpSyncContext, recordError: (message: string) => void): void {
  const manifestPath = join(ctx.sourceBase, 'mcp.json');
  if (!existsSync(manifestPath)) return;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`mcp.json: failed to parse: ${message}`);
    return;
  }

  if (!raw || typeof raw !== 'object') {
    recordError('mcp.json: expected an object');
    return;
  }

  const servers = (raw as Record<string, unknown>).servers;
  if (!Array.isArray(servers)) {
    recordError(
      'mcp.json: expected an object with "servers" array of preset id strings and/or inline server objects',
    );
    return;
  }

  const { configs, errors } = parseLlmMcpServerList(servers, BUILTIN_MCP_SERVERS);
  for (const err of errors) {
    recordError(`mcp.json: ${err}`);
  }

  const claudeOut = join(ctx.root, '.claude', 'mcp.json');
  const copilotOut = join(ctx.root, '.github', 'mcp.json');
  const cursorOut = join(ctx.root, '.cursor', 'mcp.json');

  let wrote = 0;

  if (ctx.platforms.includes('claude')) {
    const body = `${JSON.stringify({ mcpServers: configs }, null, 2)}\n`;
    ensurePlannedDir(ctx, join(ctx.root, '.claude'));
    commitPlannedWrite(ctx, claudeOut, body);
    wrote++;
  }

  if (ctx.platforms.includes('copilot')) {
    const body = `${JSON.stringify({ servers: configs }, null, 2)}\n`;
    ensurePlannedDir(ctx, join(ctx.root, '.github'));
    commitPlannedWrite(ctx, copilotOut, body);
    wrote++;
  }

  if (ctx.platforms.includes('cursor')) {
    const body = `${JSON.stringify({ mcpServers: configs }, null, 2)}\n`;
    ensurePlannedDir(ctx, join(ctx.root, '.cursor'));
    commitPlannedWrite(ctx, cursorOut, body);
    wrote++;
  }

  if (wrote > 0 && !ctx.checkMode) {
    ctx.log(`MCP: ${servers.length} manifest entr${servers.length === 1 ? 'y' : 'ies'} from llm/mcp.json`);
    if (ctx.platforms.includes('claude')) ctx.log(`  -> .claude/mcp.json`);
    if (ctx.platforms.includes('copilot')) ctx.log(`  -> .github/mcp.json`);
    if (ctx.platforms.includes('cursor')) ctx.log(`  -> .cursor/mcp.json`);
  }
}
