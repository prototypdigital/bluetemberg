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
      "cursor": { "dir": ".cursor/agents", "ext": ".md" },
      "claude": { "dir": ".claude/agents", "ext": ".md" },
      "copilot": { "dir": ".github/agents", "ext": ".agent.md" }
    },
    "skills": {
      "cursor": { "dir": ".cursor/skills" },
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

Invalid `targets` shapes (wrong types, unknown platform keys, empty `dir` / missing `ext` for rules and agents) cause **`bluetemberg sync` to fail at config load** with a clear error. Omit a section entirely if you do not use that content type.

#### Line endings and `--check`

On Windows, Git may checkout files with CRLF. Check mode compares normalized line endings (CRLF vs LF is ignored) so CI is less likely to report false drift. You can still enforce LF for generated paths in `.gitattributes`, for example:

```
.cursor/rules/** text eol=lf
.cursor/agents/** text eol=lf
.cursor/skills/** text eol=lf
.claude/** text eol=lf
.github/instructions/** text eol=lf
.github/agents/** text eol=lf
.github/skills/** text eol=lf
.github/prompts/** text eol=lf
.github/copilot-instructions.md text eol=lf
```

Adjust the list to match the platforms and directories you use.

#### Stale generated files (`sync --prune`)

Sync normally **only writes**; it does not delete old outputs when you remove or rename a source file under `llm/`. Run **`bluetemberg sync --prune`** after editing sources to remove generated files that are no longer part of the current plan (under the same managed directories the built-in sync writes to).

**Caveats:** `--prune` runs only after a write pass with **no recorded errors**. It does not delete files your **adapters** create unless those adapters record outputs via `commitPlannedWrite` and pass through `expectedOutputPaths` from the adapter context (see [Adapters](Adapters)). Hand-edited copies under managed dirs may be removed if they are not regenerated. **Do not** point `targets.*.*.dir` at a directory that contains unrelated files you care about.

**Before you `--prune`:**

- Commit or stash so you can revert if something unexpected is removed.
- Confirm each `targets.*.*.dir` is **only** for Bluetemberg-generated files (not a shared docs or src tree).
- If you use **adapters**, ensure they register outputs with `commitPlannedWrite` and the sink’s `expectedOutputPaths` when pruning (see [Adapters](Adapters)).

**Disabled platforms:** Prune only scans outputs for **platforms listed in `platforms`**. Removing a platform from config does **not** delete its old generated files (for example a leftover `.claude/mcp.json` after you drop `"claude"`). Delete those paths manually or temporarily re-enable the platform and run a normal write + `--prune` if the files still match the built-in layout.

#### Rules targets

| Platform | Default dir            | Default ext        |
| -------- | ---------------------- | ------------------ |
| cursor   | `.cursor/rules`        | `.mdc`             |
| claude   | `.claude/rules`        | `.md`              |
| copilot  | `.github/instructions` | `.instructions.md` |

#### Agent targets

| Platform | Default dir      | Default ext |
| -------- | ---------------- | ----------- |
| cursor   | `.cursor/agents` | `.md`       |
| claude   | `.claude/agents` | `.md`       |
| copilot  | `.github/agents` | `.agent.md` |

#### Skill targets

| Platform | Default dir      |
| -------- | ---------------- |
| cursor   | `.cursor/skills` |
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
