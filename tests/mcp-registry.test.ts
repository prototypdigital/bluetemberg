import { describe, it, expect } from 'vitest';
import { BUILTIN_MCP_SERVERS, parseLlmMcpServerList } from '../src/mcp/registry.js';

describe('parseLlmMcpServerList', () => {
  it('resolves preset ids from the registry', () => {
    const { configs, errors } = parseLlmMcpServerList(['github'], BUILTIN_MCP_SERVERS);
    expect(errors).toEqual([]);
    expect(configs.github?.type).toBe('http');
  });

  it('accepts inline objects without a preset', () => {
    const { configs, errors } = parseLlmMcpServerList(
      [{ id: 'mine', type: 'stdio', command: 'my-cli' }],
      BUILTIN_MCP_SERVERS,
    );
    expect(errors).toEqual([]);
    expect(configs.mine).toEqual({ type: 'stdio', command: 'my-cli' });
  });

  it('reports duplicate ids', () => {
    const { configs, errors } = parseLlmMcpServerList(['interactive', 'interactive'], BUILTIN_MCP_SERVERS);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
    expect(Object.keys(configs)).toEqual(['interactive']);
  });

  it('reports unknown preset strings', () => {
    const { errors } = parseLlmMcpServerList(['nope'], BUILTIN_MCP_SERVERS);
    expect(errors.some((e) => e.includes('unknown server id'))).toBe(true);
  });
});
