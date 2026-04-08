# Configuration

Blueprint stores project settings in `blueprint.config.json` at the repository root. This file is created by `blueprint init` and read by `blueprint sync`.

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
  }
}
```

## Fields

### `platforms`

Array of target platforms. Valid values: `"cursor"`, `"claude"`, `"copilot"`.

Only selected platforms get generated output during sync.

### `source`

Directory name containing vendor-neutral sources. Default: `"llm"`.

The sync engine reads from `<source>/rules/`, `<source>/agents/`, and `<source>/skills/`.

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

## Default behavior

If `blueprint.config.json` does not exist, `blueprint sync` uses defaults: all three platforms, `llm` as source directory, and standard target paths.
