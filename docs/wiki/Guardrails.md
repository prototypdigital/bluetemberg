# Guardrails

Guardrails are declarative hook definitions. You describe a check once — "block this tool call when a field looks wrong" — and `bluetemberg sync` translates it into platform-native enforcement. Unlike rules (which an AI assistant can ignore), guardrails are enforced by the platform itself.

## Where guardrails live

Guardrails are Markdown files with structured frontmatter in `guardrails/` under any source directory:

- `llm/guardrails/` in your project (highest priority)
- `extends` source dirs
- installed packs (e.g. [`bluetemberg-guardrails-git`](https://github.com/prototypdigital/bluetemberg-packs))

Sources merge with the same precedence as rules — a local file with the same name overrides a pack's.

The init wizard adds the default guardrail pack to `llm/packages.json`; run `bluetemberg install` and `bluetemberg sync` to activate it.

## File format

```markdown
---
description: Enforce conventional branch names before creating a worktree
trigger: EnterWorktree
hook_type: PreToolUse
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'EnterWorktree requires a conventional branch name (type/description).'
platforms:
  - claude
---

# Conventional Branch Names

Human-readable explanation of what this guardrail does.
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `trigger` | Yes | Tool name the hook matches (e.g. `EnterWorktree`) |
| `hook_type` | No | `PreToolUse` (default) or `PostToolUse` |
| `check.field` | Yes | Field extracted from the tool input JSON |
| `check.not_empty` | No | Fail when the field is empty |
| `check.matches` | No | Fail when the field does **not** match this regex |
| `check.not_matches` | No | Fail when the field **does** match this regex |
| `message` | Yes | Shown to the agent when the check fails |
| `platforms` | No | Limit to specific platforms; omit for all supported |

At least one `check` condition is required — a guardrail with none is reported as a sync error.

## Platform output

| Platform | Output |
| -------- | ------ |
| Claude Code | `hooks` section in `.claude/settings.json` (`PreToolUse`/`PostToolUse` command hooks) |
| Others | Not yet supported — guardrails are skipped |

The `hooks` section in `.claude/settings.json` is bluetemberg-owned whenever guardrail sources or a project-local `llm/hooks.claude.json` exist, and fully regenerated on each sync: guardrail-generated entries come first, followed by entries from `llm/hooks.claude.json` (see [Writing Hooks](Writing-Hooks) for the full precedence contract). All other keys in the file are preserved.

Guardrails are the **only pack-shippable hook surface**: they are declarative single-field checks compiled into a fixed injection-safe script, so packs can never ship arbitrary shell. Free-form command hooks (`llm/hooks.claude.json`) are honored only from the project's own source directory.

## Official guardrail packs

| Package | Guardrails |
| ------- | ---------- |
| `bluetemberg-guardrails-git` | `conventional-branch-names` — block AI-generated worktree branch names, require `type/description` |

To add or change official guardrails, contribute to [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs).

## Guardrail vs rule vs skill

- **Rule** — guidance the assistant reads and follows; not enforced.
- **Guardrail** — a hard check the platform enforces; the assistant cannot skip it.
- **Skill** — an on-demand multi-step workflow the assistant invokes.

If violating it must be impossible rather than discouraged, it's a guardrail.
