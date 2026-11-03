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

const NAME_LINE = /^name:[ \t]*(.*?)[ \t]*$/m;

/** A one-line YAML scalar's value: a quoted string's contents, else the text before a ` #` comment. */
function yamlScalar(raw: string): string {
  const quoted = /^(["'])(.*)\1/.exec(raw);
  if (quoted) return quoted[2];
  return raw.replace(/\s+#.*$/, '').trim();
}
/** Claude Code skips an agent file whose name is longer than this. */
const CLAUDE_AGENT_NAME_MAX = 256;

/**
 * Why Claude Code would skip this agent, or `null` when it loads. Since 2.1.218 Claude Code rejects
 * an agent `name` containing `:`, which is reserved for plugin namespacing (`plugin:agent`), and it
 * also skips one that starts with `-` or runs past 256 characters. The file is skipped with nothing
 * but a debug-log line, so sync says so instead. The name is the frontmatter `name`, else the file name.
 */
export function claudeAgentNameProblem(content: string, fileName: string): string | null {
  const yaml = content.match(FRONTMATTER)?.[2] ?? '';
  const raw = yaml.match(NAME_LINE)?.[1];
  const declared = raw === undefined ? undefined : yamlScalar(raw);
  const name = declared || fileName.replace(/\.md$/, '');
  if (name.includes(':'))
    return `agent name "${name}" contains ":", which Claude Code reserves for plugin namespacing`;
  if (name.startsWith('-')) return `agent name "${name}" starts with "-"`;
  if (name.length > CLAUDE_AGENT_NAME_MAX)
    return `agent name is longer than ${CLAUDE_AGENT_NAME_MAX} characters`;
  return null;
}
