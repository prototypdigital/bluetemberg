import { describe, expect, it } from 'vitest';
import { toClaudeAgentContent } from '../src/sync/claude-agent-tools.js';

const agent = (toolsLine: string) => `---\nname: a\n${toolsLine}\n---\n\n# Body\ntools: ["read"]\n`;

describe('toClaudeAgentContent', () => {
  it('expands read-only agents without write tools', () => {
    expect(toClaudeAgentContent(agent('tools: ["read", "search"]'))).toContain(
      'tools: ["Read", "Grep", "Glob"]',
    );
  });

  it('passes through already-native and MCP tool names and de-duplicates', () => {
    const out = toClaudeAgentContent(agent('tools: ["read", "Read", "mcp__x__y", "WebFetch"]'));
    expect(out).toContain('tools: ["Read", "mcp__x__y", "WebFetch"]');
  });

  it('accepts a comma-separated string form', () => {
    expect(toClaudeAgentContent(agent('tools: read, execute'))).toContain('tools: ["Read", "Bash"]');
  });

  it('rewrites a block-sequence tools list instead of mangling it', () => {
    const out = toClaudeAgentContent('---\nname: a\ntools:\n  - read\n  - edit\nmodel: x\n---\nbody\n');
    expect(out).toBe('---\nname: a\ntools: ["Read", "Edit", "Write"]\nmodel: x\n---\nbody\n');
  });

  it('rewrites an unindented block sequence too', () => {
    const out = toClaudeAgentContent('---\nname: a\ntools:\n- search\n---\nbody\n');
    expect(out).toBe('---\nname: a\ntools: ["Grep", "Glob"]\n---\nbody\n');
  });

  it('leaves a bare tools: (null, inherit every tool) as it is, never []', () => {
    const src = '---\nname: a\ntools:\nmodel: x\n---\nbody\n';
    expect(toClaudeAgentContent(src)).toBe(src);
  });

  it('leaves agents without a tools line byte-identical', () => {
    const content = '---\nname: a\n---\n\nbody\n';
    expect(toClaudeAgentContent(content)).toBe(content);
  });

  it('does not touch a tools line in the body', () => {
    const out = toClaudeAgentContent(agent('tools: ["edit"]'));
    expect(out.endsWith('# Body\ntools: ["read"]\n')).toBe(true);
  });
});
