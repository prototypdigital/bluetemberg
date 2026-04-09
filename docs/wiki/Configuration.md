# Configuration

Bluetemberg stores project settings in `bluetemberg.config.json` at the repository root. This file is created by `bluetemberg init` and read by `bluetemberg sync`.

## Schema

```json
{
  "platforms": ["cursor", "claude", "copilot"],
  "source": "llm",
  "targets": {
    "rules": {
      "cursor": { "dir": ".cursor/rules", "ext": ".mdc" },
      "claude": { "dir": ".claude/rules", "ext": ".md" },
      "copilot": { "dir": ".github/instructions", "ext": ".instructions.md" }
    },
    "agents": {
      "claude": { "dir": ".claude/agents", "ext": ".md" },
      "copilot": { "dir": ".github/agents", "ext": ".agent.md" }
    },
    "skills": {
      "claude": { "dir": ".claude/skills" },
      "copilot": { "dir": ".github/skills" }
    }
  },
  "adapters": ["@your-scope/your-bluetemberg-adapter"]
}
```

The `adapters` field is optional. Omit it or use `[]` if you only rely on built-in sync steps.

## Fields

### `platforms`

Array of target platforms. Valid values: `"cursor"`, `"claude"`, `"copilot"`.

Only selected platforms get generated output during sync.

### `source`

Directory name containing vendor-neutral sources. Default: `"llm"`.

The sync engine reads from `<source>/rules/`, `<source>/agents/`, `<source>/skills/`, and optionally `<source>/mcp.json`, `<source>/hooks.json`, `<source>/commands/`, and `<source>/prompts/` (see [Adapters](Adapters)).

### `adapters`

Optional array of **strings** passed to `import()`: npm package names (must be installed in the consumer project), `file:` URLs, or absolute `file://` URLs. Loaded **after** all built-in steps. Specifiers execute code at sync time — use only **trusted** modules; see [Adapters](Adapters) for the module contract and security notes.

### `targets`

Maps each content type (rules, agents, skills) to platform-specific output directories and file extensions.

#### Rules targets

| Platform | Default dir            | Default ext        |
| -------- | ---------------------- | ------------------ |
| cursor   | `.cursor/rules`        | `.mdc`             |
| claude   | `.claude/rules`        | `.md`              |
| copilot  | `.github/instructions` | `.instructions.md` |

#### Agent targets

| Platform | Default dir      | Default ext |
| -------- | ---------------- | ----------- |
| claude   | `.claude/agents` | `.md`       |
| copilot  | `.github/agents` | `.agent.md` |

Cursor does not support custom agent definitions.

#### Skill targets

| Platform | Default dir      |
| -------- | ---------------- |
| claude   | `.claude/skills` |
| copilot  | `.github/skills` |

Skills are synced as `<skill-name>/SKILL.md` within the target directory.

## MCP manifest (`llm/mcp.json`)

When this file exists, sync regenerates platform-specific MCP config:

| Platform | Output file         | JSON shape                          |
| -------- | ------------------- | ----------------------------------- |
| claude   | `.claude/mcp.json`  | `{ "mcpServers": { ... } }`         |
| copilot  | `.github/mcp.json`  | `{ "servers": { ... } }`            |
| cursor   | `.cursor/mcp.json`  | `{ "mcpServers": { ... } }`         |

The manifest is vendor-neutral. The `servers` array may contain:

1. **Strings** — preset ids built into Bluetemberg (the same ids offered during `bluetemberg init`, e.g. `interactive`, `context7`, `figma`, `github`). Unknown ids are reported as sync errors; any successfully resolved entries are still emitted.
2. **Objects** — inline server definitions that **do not** need a preset. Each object must include `id` (string, used as the key in the output map) and `type` (string). Optional fields: `command`, `args` (array of strings), `url` — same shape as the built-in preset entries.

```json
{
  "servers": [
    "interactive",
    {
      "id": "my-cli",
      "type": "stdio",
      "command": "node",
      "args": ["./tools/mcp.mjs"]
    }
  ]
}
```

Built-in presets are **convenience defaults**; vendors may change URLs or package names. Prefer **inline** objects when you need a fixed command, URL, or version without waiting for a Bluetemberg release.

After changing `mcp.json`, run `bluetemberg sync` (or your `sync:llm-config` script).

## Cursor hooks (`llm/hooks.json`)

When this file exists and **`cursor`** is in `platforms`, sync writes **`.cursor/hooks.json`** with the same logical content (validated JSON). See [Writing Hooks](Writing-Hooks).

## Claude commands (`llm/commands/`)

Markdown files in this directory (except `README.md`) are copied to **`.claude/commands/`** when **`claude`** is in `platforms`. See [Writing Commands](Writing-Commands).

## Copilot prompt files (`llm/prompts/`)

Markdown files here are copied to **`.github/prompts/`** with the `*.prompt.md` suffix Copilot expects when **`copilot`** is in `platforms`. See [Writing Prompts](Writing-Prompts).

## Default behavior

If `bluetemberg.config.json` does not exist, `bluetemberg sync` uses defaults: all three platforms, `llm` as source directory, and standard target paths.
