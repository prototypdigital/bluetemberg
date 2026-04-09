import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import { BUILTIN_MCP_SERVERS, resolveMcpServerIds } from '../mcp/registry.js';
import { ensureDir } from '../utils/fs.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite } from './pipeline.js';

export interface McpSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

function parseLlmMcpManifest(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const servers = (raw as { servers?: unknown }).servers;
  if (!isStringArray(servers)) return null;
  return servers;
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

  const serverIds = parseLlmMcpManifest(raw);
  if (serverIds === null) {
    recordError('mcp.json: expected an object with "servers" array of string ids');
    return;
  }

  const { configs, unknownIds } = resolveMcpServerIds(serverIds, BUILTIN_MCP_SERVERS);
  for (const id of unknownIds) {
    recordError(`mcp.json: unknown server id "${id}" (not in built-in registry)`);
  }

  const claudeOut = join(ctx.root, '.claude', 'mcp.json');
  const copilotOut = join(ctx.root, '.github', 'mcp.json');
  const cursorOut = join(ctx.root, '.cursor', 'mcp.json');

  let wrote = 0;

  if (ctx.platforms.includes('claude')) {
    const body = `${JSON.stringify({ mcpServers: configs }, null, 2)}\n`;
    ensureDir(join(ctx.root, '.claude'));
    commitPlannedWrite(ctx, claudeOut, body);
    wrote++;
  }

  if (ctx.platforms.includes('copilot')) {
    const body = `${JSON.stringify({ servers: configs }, null, 2)}\n`;
    ensureDir(join(ctx.root, '.github'));
    commitPlannedWrite(ctx, copilotOut, body);
    wrote++;
  }

  if (ctx.platforms.includes('cursor')) {
    const body = `${JSON.stringify({ mcpServers: configs }, null, 2)}\n`;
    ensureDir(join(ctx.root, '.cursor'));
    commitPlannedWrite(ctx, cursorOut, body);
    wrote++;
  }

  if (wrote > 0 && !ctx.checkMode) {
    ctx.log(`MCP: ${serverIds.length} server(s) from llm/mcp.json`);
    if (ctx.platforms.includes('claude')) ctx.log(`  -> .claude/mcp.json`);
    if (ctx.platforms.includes('copilot')) ctx.log(`  -> .github/mcp.json`);
    if (ctx.platforms.includes('cursor')) ctx.log(`  -> .cursor/mcp.json`);
  }
}
