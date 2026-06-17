import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  it('exposes the read-only tools with well-formed object schemas (no M7 scaffold)', () => {
    const names = STACKS_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'bluetemberg_detect_stacks',
      'bluetemberg_query_coverage',
      'bluetemberg_list_stacks',
      'bluetemberg_org_histogram',
    ]);
    expect(names).not.toContain('bluetemberg_scaffold_from_gap'); // parked (M7)
    for (const tool of STACKS_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
    }
    const coverage = STACKS_MCP_TOOLS.find((t) => t.name === 'bluetemberg_query_coverage');
    expect(coverage?.inputSchema.required).toEqual(['stack']);
    const histogram = STACKS_MCP_TOOLS.find((t) => t.name === 'bluetemberg_org_histogram');
    // roots, org, repos are all optional — any combination is valid; handler validates at least one
    expect(histogram?.inputSchema.required).toBeUndefined();
    expect(histogram?.inputSchema.properties).toHaveProperty('org');
    expect(histogram?.inputSchema.properties).toHaveProperty('repos');
  });
});

describe('callStacksTool', () => {
  let root: string;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    root = createTmpDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it('detect_stacks returns the detection report', async () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = (await callStacksTool(root, 'bluetemberg_detect_stacks', {})) as {
      detected: Array<{ stack: string }>;
    };
    expect(result.detected.some((e) => e.stack === 'payload')).toBe(true);
  });

  it('query_coverage returns a coverage report for the requested stack', async () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = (await callStacksTool(root, 'bluetemberg_query_coverage', {
      stack: 'payload',
      version: '3.4.1',
    })) as { result: { known: boolean; covered: boolean } };
    expect(result.result.known).toBe(true);
    expect(result.result.covered).toBe(true);
  });

  it('query_coverage throws when "stack" is missing or empty', async () => {
    writeConfig(root);
    await expect(callStacksTool(root, 'bluetemberg_query_coverage', {})).rejects.toThrow(/stack/);
    await expect(
      callStacksTool(root, 'bluetemberg_query_coverage', { stack: '  ' }),
    ).rejects.toThrow(/stack/);
  });

  it('list_stacks returns the live registry entries', async () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = (await callStacksTool(root, 'bluetemberg_list_stacks', {})) as Array<{
      name: string;
      detected: boolean;
    }>;
    const payload = result.find((e) => e.name === 'payload');
    expect(payload?.detected).toBe(true);
  });

  it('org_histogram scans local roots and returns a histogram report', async () => {
    writeConfig(root, { payload: '3.4.1' });
    writeCatalog(root);
    const result = (await callStacksTool(root, 'bluetemberg_org_histogram', { roots: ['.'] })) as {
      scanned: number;
      histogram: Array<{ stack: string }>;
    };
    expect(result.scanned).toBe(1);
    expect(result.histogram.some((h) => h.stack === 'payload')).toBe(true);
  });

  it('org_histogram scans remote repos via the API and merges into histogram', async () => {
    writeCatalog(root);
    // Token must come from the environment — never from tool args (security constraint).
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('acme/web/contents/package.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify({ dependencies: { next: '^15.0.0' } })),
          json: () => Promise.resolve({ dependencies: { next: '^15.0.0' } }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        text: () => Promise.resolve(''),
        json: () => Promise.resolve(null),
      });
    });

    try {
      const result = (await callStacksTool(root, 'bluetemberg_org_histogram', {
        repos: ['acme/web'],
      })) as { scanned: number; histogram: Array<{ stack: string }> };
      expect(result.scanned).toBe(1);
      expect(result.histogram.some((h) => h.stack === 'nextjs')).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = saved;
    }
  });

  it('org_histogram throws when none of roots/org/repos is provided', async () => {
    writeConfig(root);
    await expect(callStacksTool(root, 'bluetemberg_org_histogram', {})).rejects.toThrow(/roots|org|repos/);
    await expect(
      callStacksTool(root, 'bluetemberg_org_histogram', { roots: [] }),
    ).rejects.toThrow(/roots|org|repos/);
  });

  it('throws on an unknown tool', async () => {
    writeConfig(root);
    await expect(callStacksTool(root, 'bluetemberg_nope', {})).rejects.toThrow(/Unknown tool/);
  });
});
