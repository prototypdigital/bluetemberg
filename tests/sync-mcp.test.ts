import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../src/sync/index.js';
import { BUILTIN_MCP_SERVERS } from '../src/mcp/registry.js';
import type { BlueprintConfig } from '../src/types.js';

const CONFIG: BlueprintConfig = { platforms: ['claude', 'copilot', 'cursor'], source: 'llm', targets: {} };

const USER_MCP = {
  mcpServers: {
    'my-db': { command: 'node', args: ['./db.mjs'], env: { DB_URL: '${DB_URL}' } },
  },
};

function createTmpDir(): string {
  const dir = join(tmpdir(), `bluetemberg-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'llm'), { recursive: true });
  return dir;
}

type McpFile = { mcpServers: Record<string, Record<string, unknown>> };

describe('sync root .mcp.json', () => {
  let root: string;

  const writeManifest = (servers: unknown[]): void =>
    writeFileSync(join(root, 'llm', 'mcp.json'), JSON.stringify({ servers }, null, 2) + '\n');
  const writeRootMcp = (value: unknown): void =>
    writeFileSync(join(root, '.mcp.json'), JSON.stringify(value, null, 2) + '\n');
  const readRaw = (): string => readFileSync(join(root, '.mcp.json'), 'utf8');
  const readRootMcp = (): McpFile => JSON.parse(readRaw()) as McpFile;
  const readOwned = (): string[] =>
    (JSON.parse(readFileSync(join(root, 'llm', 'mcp-managed.json'), 'utf8')) as { servers: string[] })
      .servers;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('merges managed servers into a hand-written .mcp.json without touching the user entries', async () => {
    writeRootMcp({ $schema: 'x', ...USER_MCP });
    writeManifest(['context7', 'figma']);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors).toEqual([]);
    const mcp = readRootMcp() as McpFile & { $schema: string };
    expect(mcp.$schema).toBe('x');
    expect(mcp.mcpServers['my-db']).toEqual(USER_MCP.mcpServers['my-db']);
    expect(mcp.mcpServers.context7).toEqual(BUILTIN_MCP_SERVERS.context7);
    expect(mcp.mcpServers.figma).toEqual({ type: 'http', url: 'https://mcp.figma.com/mcp' });
    expect(Object.keys(mcp.mcpServers)).toEqual(['my-db', 'context7', 'figma']);
    expect(readOwned()).toEqual(['context7', 'figma']);
  });

  it('a second sync is byte-identical and --check reports nothing', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });
    const first = readRaw();
    const firstOwned = readFileSync(join(root, 'llm', 'mcp-managed.json'), 'utf8');

    await sync(root, { config: CONFIG, silent: true });
    expect(readRaw()).toBe(first);
    expect(readFileSync(join(root, 'llm', 'mcp-managed.json'), 'utf8')).toBe(firstOwned);

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(0);
  });

  it('removing a preset from llm/mcp.json removes only that entry', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7', 'figma']);
    await sync(root, { config: CONFIG, silent: true });

    writeManifest(['figma']);
    await sync(root, { config: CONFIG, silent: true });

    expect(Object.keys(readRootMcp().mcpServers)).toEqual(['my-db', 'figma']);
    expect(readOwned()).toEqual(['figma']);
  });

  it('keeps servers added after the first sync (e.g. by `claude mcp add`)', async () => {
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });

    const mcp = readRootMcp();
    mcp.mcpServers.added = { type: 'http', url: 'https://example.com/mcp' };
    writeRootMcp(mcp);
    writeManifest([]);
    await sync(root, { config: CONFIG, silent: true });

    expect(readRootMcp().mcpServers).toEqual({ added: { type: 'http', url: 'https://example.com/mcp' } });
    expect(existsSync(join(root, 'llm', 'mcp-managed.json'))).toBe(false);
  });

  it('--check reports drift in a managed entry, but not in a user entry', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });

    const userEdit = readRootMcp();
    userEdit.mcpServers['my-db'].args = ['./other.mjs'];
    writeRootMcp(userEdit);
    expect((await sync(root, { config: CONFIG, silent: true, check: true })).outOfSync).toBe(0);

    const managedEdit = readRootMcp();
    managedEdit.mcpServers.context7.args = ['-y', 'tampered'];
    writeRootMcp(managedEdit);
    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.outOfSync).toBe(1);
  });

  it('--check reports a managed entry the manifest no longer declares', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });
    writeManifest([]);

    const before = readRaw();
    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    // .mcp.json and .cursor/mcp.json still list context7, and the ownership sidecar should be removed.
    expect(check.outOfSync).toBe(3);
    expect(readRaw()).toBe(before);
  });

  it('keeps extra fields a person added to a managed server', async () => {
    writeManifest(['github']);
    await sync(root, { config: CONFIG, silent: true });

    const mcp = readRootMcp();
    mcp.mcpServers.github.headers = { Authorization: 'Bearer ${GITHUB_PAT}' };
    writeRootMcp(mcp);
    await sync(root, { config: CONFIG, silent: true });

    expect(readRootMcp().mcpServers.github).toEqual({
      ...BUILTIN_MCP_SERVERS.github,
      headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
    });
  });

  it('takes over a hand-written server the manifest now declares, with a warning', async () => {
    writeRootMcp({ mcpServers: { context7: { command: 'npx', args: ['old'] } } });
    writeManifest(['context7']);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(readRootMcp().mcpServers.context7).toEqual(BUILTIN_MCP_SERVERS.context7);
    expect(results.warnings.some((w) => w.includes('"context7" was hand-written'))).toBe(true);
    expect(readOwned()).toEqual(['context7']);
  });

  it('never rewrites a corrupt .mcp.json', async () => {
    writeFileSync(join(root, '.mcp.json'), '{ not json');
    writeManifest(['context7']);

    const results = await sync(root, { config: CONFIG, silent: true });

    expect(readRaw()).toBe('{ not json');
    expect(results.errors.some((e) => e.startsWith('.mcp.json:'))).toBe(true);
  });

  it('leaves .mcp.json alone when a manifest entry fails to resolve', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });
    const before = readRaw();

    writeManifest(['not-a-preset']);
    const results = await sync(root, { config: CONFIG, silent: true });

    expect(results.errors.some((e) => e.includes('unknown server id'))).toBe(true);
    expect(readRaw()).toBe(before);
  });

  it('does not reformat a semantically unchanged hand-written .mcp.json', async () => {
    const fourSpace = JSON.stringify({ mcpServers: { context7: BUILTIN_MCP_SERVERS.context7 } }, null, 4);
    writeFileSync(join(root, '.mcp.json'), fourSpace);
    writeManifest(['context7']);

    await sync(root, { config: CONFIG, silent: true });

    expect(readRaw()).toBe(fourSpace);
  });

  it('writes .mcp.json for copilot alone, and not for cursor alone', async () => {
    writeManifest(['context7']);
    await sync(root, { config: { ...CONFIG, platforms: ['cursor'] }, silent: true });
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    expect(existsSync(join(root, '.cursor', 'mcp.json'))).toBe(true);

    await sync(root, { config: { ...CONFIG, platforms: ['copilot'] }, silent: true });
    expect(readRootMcp().mcpServers.context7).toBeDefined();
    expect(existsSync(join(root, '.github', 'mcp.json'))).toBe(false);
  });

  it('removes its servers from .mcp.json when claude and copilot are both deselected', async () => {
    writeRootMcp(USER_MCP);
    writeManifest(['context7']);
    await sync(root, { config: CONFIG, silent: true });

    await sync(root, { config: { ...CONFIG, platforms: ['cursor'] }, silent: true });

    expect(readRootMcp()).toEqual(USER_MCP);
  });

  it('prune removes a legacy .claude/mcp.json and .github/mcp.json the old emitter wrote', async () => {
    writeManifest(['context7']);
    const configs = { context7: BUILTIN_MCP_SERVERS.context7 };
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.claude', 'mcp.json'), JSON.stringify({ mcpServers: configs }, null, 2) + '\n');
    writeFileSync(join(root, '.github', 'mcp.json'), JSON.stringify({ servers: configs }, null, 2) + '\n');

    const check = await sync(root, { config: CONFIG, silent: true, check: true });
    expect(check.stale).toBe(2);

    await sync(root, { config: CONFIG, silent: true, prune: true });
    expect(existsSync(join(root, '.claude', 'mcp.json'))).toBe(false);
    expect(existsSync(join(root, '.github', 'mcp.json'))).toBe(false);
  });

  it('prune keeps a legacy .github/mcp.json that differs from what the old emitter wrote', async () => {
    writeManifest(['context7']);
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.github', 'mcp.json'), JSON.stringify({ servers: { mine: { url: 'x' } } }));

    await sync(root, { config: CONFIG, silent: true, prune: true });

    expect(existsSync(join(root, '.github', 'mcp.json'))).toBe(true);
  });

  it('no built-in preset uses the deprecated sse transport', () => {
    for (const preset of Object.values(BUILTIN_MCP_SERVERS)) {
      expect(preset.type).not.toBe('sse');
      if (preset.url) expect(preset.type).toBe('http');
    }
  });
});
