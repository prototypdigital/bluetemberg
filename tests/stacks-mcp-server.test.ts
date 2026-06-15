import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { STACKS_MCP_TOOLS, callStacksTool } from '../src/mcp/server.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(root: string, stacks?: Record<string, string>): void {
  writeFileSync(
    join(root, 'bluetemberg.config.json'),
    JSON.stringify({ platforms: ['claude'], source: 'llm', targets: {}, ...(stacks ? { stacks } : {}) }),
  );
}

function writeCatalog(root: string): void {
  mkdirSync(join(root, '.bluetemberg'), { recursive: true });
  writeFileSync(
    join(root, '.bluetemberg', 'catalog.json'),
    JSON.stringify({
      generated: '2026-06-15T00:00:00.000Z',
      packs: [
        {
          name: 'bluetemberg-rules-payload',
          version: '0.1.0',
          description: '',
          kind: 'rules',
          universal: false,
          profiles: [],
          stacks: ['payload'],
          rules: ['payload-thing'],
          preview: '',
        },
      ],
    }),
  );
}

describe('STACKS_MCP_TOOLS', () => {
  it('exposes the three read-only tools with well-formed object schemas (no M7 scaffold)', () => {
    const names = STACKS_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'bluetemberg_detect_stacks',
      'bluetemberg_query_coverage',
      'bluetemberg_list_stacks',
    ]);
    expect(names).not.toContain('bluetemberg_scaffold_from_gap'); // parked (M7)
    for (const tool of STACKS_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
    }
    const coverage = STACKS_MCP_TOOLS.find((t) => t.name === 'bluetemberg_query_coverage');
    expect(coverage?.inputSchema.required).toEqual(['stack']);
  });
});

describe('callStacksTool', () => {
  let root: string;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('detect_stacks returns the detection report', () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = callStacksTool(root, 'bluetemberg_detect_stacks', {}) as {
      detected: Array<{ stack: string }>;
    };
    expect(result.detected.some((e) => e.stack === 'payload')).toBe(true);
  });

  it('query_coverage returns a coverage report for the requested stack', () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = callStacksTool(root, 'bluetemberg_query_coverage', {
      stack: 'payload',
      version: '3.4.1',
    }) as { result: { known: boolean; covered: boolean } };
    expect(result.result.known).toBe(true);
    expect(result.result.covered).toBe(true);
  });

  it('query_coverage throws when "stack" is missing or empty', () => {
    writeConfig(root);
    expect(() => callStacksTool(root, 'bluetemberg_query_coverage', {})).toThrow(/stack/);
    expect(() => callStacksTool(root, 'bluetemberg_query_coverage', { stack: '  ' })).toThrow(/stack/);
  });

  it('list_stacks returns the live registry entries', () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = callStacksTool(root, 'bluetemberg_list_stacks', {}) as Array<{
      name: string;
      detected: boolean;
    }>;
    const payload = result.find((e) => e.name === 'payload');
    expect(payload?.detected).toBe(true);
  });

  it('throws on an unknown tool', () => {
    writeConfig(root);
    expect(() => callStacksTool(root, 'bluetemberg_nope', {})).toThrow(/Unknown tool/);
  });
});
