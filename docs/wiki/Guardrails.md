# Guardrails

Guardrails are declarative hook definitions. You describe a check once — "block this tool call when a field looks wrong" — and `bluetemberg sync` translates it into an enforced hook. They compile to Claude Code and Cursor today (see [Platform output](#platform-output)). Unlike rules (which an AI assistant can ignore), guardrails are enforced by the platform itself.

## Where guardrails live

Guardrails are Markdown files with structured frontmatter in `guardrails/` under any source directory:

- `llm/guardrails/` in your project (highest priority)
- `extends` source dirs
- installed packs (e.g. [`bluetemberg-guardrails-git`](https://github.com/prototypdigital/bluetemberg-packs))

Sources merge with the same precedence as rules — a local file with the same name overrides a pack's.

`init --non-interactive` adds the default guardrail pack to `llm/packages.json`; the interactive wizard doesn't ask about guardrails yet, so add it with `bluetemberg add bluetemberg-guardrails-git`. Run `bluetemberg install` and `bluetemberg sync` to activate it.

Removing a guardrail — deleting the file, or `bluetemberg remove` on the pack that shipped it — removes its hook from `.claude/settings.json` on the next `sync`. Only hooks bluetemberg generated are touched; hand-written entries in the same file stay.

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
| `check.field` | Yes | Dotted path into the tool's arguments (`tool_input` in the hook payload), e.g. `name`, `command` or `file-path`. Only `tool_input` is read; a leading `tool_input.` is accepted and ignored, so `tool_input.name` means `name`. If the payload cannot be read (no `jq`, or the path runs through a non-object), the hook blocks |
| `check.not_empty` | No | Fail when the field is empty |
| `check.matches` | No | Fail when the field does **not** match this POSIX ERE |
| `check.not_matches` | No | Fail when the field **does** match this POSIX ERE |
| `message` | Yes | Shown to the agent when the check fails |
| `platforms` | No | Limit to specific platforms (`claude`, `cursor`). Leave it out to compile for every supported platform |

At least one `check` condition is required — a guardrail with none is reported as a sync error.

## Condition regexes

`check.matches` and `check.not_matches` are **POSIX ERE**, not JavaScript regexes. The generated hook evaluates them with bash `[[ "$value" =~ $pattern ]]`, so the host's C library compiles them. JavaScript and Perl idioms are unavailable — and the dangerous part is that several of them do not error, they compile to something else. `\d` is a literal `d` on BSD libc, so `not_matches: '\d+'` reads as a digit check and quietly tests for the letter "d".

| Instead of | Write |
| ---------- | ----- |
| `\d`, `\D` | `[[:digit:]]`, `[^[:digit:]]` |
| `\w`, `\W` | `[[:alnum:]_]`, `[^[:alnum:]_]` |
| `\s`, `\S` | `[[:space:]]`, `[^[:space:]]` |
| `\A`, `\z`, `\Z` | `^`, `$` |
| `\b`, `\B`, `\<`, `\>` | no portable form — match the surrounding characters explicitly |
| `(?:…)`, `(?=…)`, `(?!…)` | plain groups `(…)`; lookaround has no ERE equivalent |
| `a+?`, `a*?` | no non-greedy form in ERE |
| `\p{L}` | no Unicode property classes in ERE |

`bluetemberg sync` validates every condition regex against portable ERE and reports the guardrail as a sync error when it does not qualify, naming the field and the remedy. A rejected guardrail generates no hook, so the failure is loud rather than a hook that never fires.

### Failing closed

A condition that cannot be evaluated **blocks** the tool call. If a pattern still reaches the hook and fails to compile — a hand-edited `.claude/settings.json`, or one committed on a platform whose libc accepts the pattern and run on a platform whose libc rejects it — the hook exits non-zero and reports the broken regex, instead of reading the compile failure as "condition not met" and allowing the call.

This is deliberate. A guardrail that cannot check its own condition is not evidence that the operation is safe (GHSA-grpx-fj8v-q8g9).

## Platform output

| Platform | Output |
| -------- | ------ |
| Claude Code | `hooks` section in `.claude/settings.json` (`PreToolUse`/`PostToolUse` command hooks) |
| Cursor | `preToolUse` / `postToolUse` entries in `.cursor/hooks.json`, for triggers with a Cursor equivalent (below) |
| Copilot, Codex, Devin, Gemini, Antigravity | Not yet supported — guardrails are skipped |

### Cursor

Cursor runs the same fixed script, and it blocks the same way (exit code 2). The trigger is mapped to Cursor's tool name, and `check.field` reads Cursor's `tool_input` just as it does Claude's:

| Guardrail `trigger` (Claude Code tool) | Cursor `tool_name` |
| -------------------------------------- | ------------------ |
| `Bash` | `Shell` |

Only tools whose Cursor arguments are documented to match are mapped; Cursor documents `tool_input` for `Shell` alone. A guardrail whose trigger has no mapping (such as `EnterWorktree`, which has no Cursor equivalent) is enforced in Claude Code only, and sync says so in its output. Each Cursor entry sets `failClosed: true`: Cursor lets a call through when a hook crashes, times out or prints nothing unexpected, which would silently switch a guardrail off.

`.cursor/hooks.json` follows the same ownership rule as Claude's `hooks` key. While guardrails or `llm/hooks.json` exist, sync writes the file whole: guardrail entries first, then the `llm/hooks.json` entries. When neither exists, sync removes only the entries it generated for guardrails and keeps the rest.

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
