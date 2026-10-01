/**
 * Bluetemberg agents declare `tools` with abstract capability names (`read`, `search`,
 * `edit`, `execute`) that Copilot understands. Claude Code only resolves its own tool
 * names, so an abstract-only list leaves the agent with no usable tools and it refuses
 * to spawn. The claude target gets the concrete names instead.
 */
const CLAUDE_TOOLS_BY_CAPABILITY: Record<string, string[]> = {
  read: ['Read'],
  search: ['Grep', 'Glob'],
  edit: ['Edit', 'Write'],
  execute: ['Bash'],
};

const INLINE_TOOLS_LINE = /^tools:[ \t]*(?:\[([^\]\n]*)\]|([^\n[]*))[ \t]*$/m;
const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

/** Map one declared tool name; names that are not abstract capabilities pass through untouched. */
function toClaudeTools(name: string): string[] {
  return CLAUDE_TOOLS_BY_CAPABILITY[name.toLowerCase()] ?? [name];
}

function parseToolNames(list: string): string[] {
  return list
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter((name) => name !== '');
}

/**
 * Rewrite the frontmatter `tools:` line of an agent to Claude Code tool names.
 * Content without a single-line `tools:` declaration (or without frontmatter) is returned as-is,
 * so omitted `tools` still means "inherit everything" and other keys are never reformatted.
 */
export function toClaudeAgentContent(content: string): string {
  const frontmatter = content.match(FRONTMATTER);
  if (!frontmatter) return content;

  const [whole, open, yaml, close] = frontmatter;
  const toolsLine = yaml.match(INLINE_TOOLS_LINE);
  if (!toolsLine) return content;

  const declared = parseToolNames(toolsLine[1] ?? toolsLine[2] ?? '');
  const resolved = [...new Set(declared.flatMap(toClaudeTools))];
  const rewritten = `tools: [${resolved.map((name) => `"${name}"`).join(', ')}]`;
  const newYaml = yaml.replace(INLINE_TOOLS_LINE, rewritten);
  return open + newYaml + close + content.slice(whole.length);
}
