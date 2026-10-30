# Writing commands (Claude Code)

> **Deprecated output.** Claude Code has merged custom commands into skills. Sync now also writes every command as a generated skill to each skills target, and the `.claude/commands/` output is kept for a transition period only: it stops being written in 0.18.0. New work belongs in [`llm/skills/`](Writing-Skills). See [Migrating commands and prompts](Writing-Skills#migrating-commands-and-prompts).

Project-local **slash commands** live under `llm/commands/` as Markdown files. The file name (without `.md`) becomes the command name (e.g. `review.md` → `/review`). Sync writes each one twice:

- to `.claude/commands/` (Claude Code), adding only the generated-file banner. Deprecated; see the removal plan.
- as a generated skill, `<skills dir>/<name>/SKILL.md`, to every skills target of the enabled platforms (`.claude/skills/`, `.github/skills/`, `.cursor/skills/`, `.agents/skills/`). The skill gets `name`, a `description` and `disable-model-invocation: true`, so it stays a command the user runs as `/name`.

Claude Code resolves a skill and a command with the same name to the skill, so `/name` keeps working, unchanged, while both exist.

## Layout

```
llm/commands/
├── README.md          # optional; not synced
└── my-workflow.md     # → .claude/commands/my-workflow.md
                       #   + .claude/skills/my-workflow/SKILL.md (and every other skills dir)
```

## Format

Use normal Markdown plus optional YAML frontmatter Claude Code understands, for example:

```markdown
---
description: Short summary for the command menu
argument-hint: '[version]'
allowed-tools: Read, Grep, Bash
---

Your instructions for the model. Use $ARGUMENTS for text after the command name.
```

Command fields are Claude Code skill fields too, so the generated skill keeps them. Only Claude Code substitutes `$ARGUMENTS`; other hosts pass the text after `/name` to the model as context. Refer to [Claude Code: Skills](https://code.claude.com/docs/en/skills) for current fields and behavior.

The file name must be a valid skill name (lowercase letters, digits and single hyphens, at most 64 characters) to get a skill. Otherwise sync warns and writes only the `.claude/commands/` file.

## When sync runs

The `.claude/commands/` output is written only if **`claude`** is in `platforms`. The generated skill is written for every enabled platform that has a skills target. After editing `llm/commands/`, run `bluetemberg sync` (or your `sync:llm-config` script). Commands are read from the project's own `llm/` only.

If `llm/skills/<name>/` also exists, the real skill wins and the command gets no generated skill (sync warns).

## Devin Desktop (formerly Windsurf)

Commands used to be copied to `.windsurf/workflows/` as Windsurf workflows. Devin Desktop deprecated workflows in favor of skills, so sync no longer writes them. Devin now gets each command as a generated skill in `.agents/skills/`. Run `bluetemberg sync --prune` once to remove the old generated workflow files.

## Personal overrides

Untracked or gitignored files under `.claude/commands/` are not removed by sync; only paths that correspond to `llm/commands/*.md` are overwritten when you sync. A hand-written `SKILL.md` (no generated-file banner) in a skills dir is never overwritten by a generated one.
