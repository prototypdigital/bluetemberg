# Writing commands (Claude Code)

Project-local **slash commands** for Claude Code live under `llm/commands/` as Markdown files. Sync copies them **verbatim** to `.claude/commands/`. The file name (without `.md`) becomes the command name (e.g. `review.md` → `/review`).

## Layout

```
llm/commands/
├── README.md          # optional; not synced
└── my-workflow.md     # synced → .claude/commands/my-workflow.md
```

## Format

Use normal Markdown plus optional YAML frontmatter Claude Code understands, for example:

```markdown
---
description: Short summary for the command menu
allowed-tools: Read, Grep, Bash
---

Your instructions for the model. Use $ARGUMENTS for text after the command name.
```

Bluetemberg does not transform this content. Refer to [Claude Code documentation](https://code.claude.com/docs) for current frontmatter fields and behavior.

## When sync runs

Commands are emitted only if **`claude`** is listed in `platforms` in `bluetemberg.config.json`. After editing `llm/commands/`, run `bluetemberg sync` (or your `sync:llm-config` script).

## Personal overrides

Untracked or gitignored files under `.claude/commands/` are not removed by sync; only paths that correspond to `llm/commands/*.md` are overwritten when you sync.
