# Guardrails

Guardrails are declarative hook definitions. You describe a check once — "block this tool call when a field looks wrong" — and `bluetemberg sync` translates it into an enforced hook. They compile to Claude Code, Cursor, GitHub Copilot, Devin Desktop and Codex today (see [Platform output](#platform-output)). Unlike rules (which an AI assistant can ignore), guardrails are enforced by the platform itself.

## Where guardrails live

Guardrails are Markdown files with structured frontmatter in `guardrails/` under any source directory:

- `llm/guardrails/` in your project (highest priority)
- `extends` source dirs
- installed packs (e.g. [`bluetemberg-guardrails-git`](https://github.com/prototypdigital/bluetemberg-packs))

Sources merge with the same precedence as rules — a local file with the same name overrides a pack's.

`init --non-interactive` adds the default guardrail pack to `llm/packages.json`; the interactive wizard doesn't ask about guardrails yet, so add it with `bluetemberg add bluetemberg-guardrails-git`. Run `bluetemberg install` and `bluetemberg sync` to activate it.

Removing a guardrail — deleting the file, or `bluetemberg remove` on the pack that shipped it — removes its hook from `.claude/settings.json`, `.cursor/hooks.json`, `.github/hooks/bluetemberg-guardrails.json`, `.devin/hooks.v1.json` and `.codex/config.toml` on the next `sync`. Only hooks bluetemberg generated are touched; hand-written entries in the same file stay.

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
| `message` | Yes | Shown to the agent when the check fails. Must not be blank |
| `platforms` | No | A YAML list that limits the guardrail to specific platforms (`claude`, `cursor`, `copilot`, `devin`, `codex`; `windsurf` is accepted as an alias for `devin`). Leave it out to compile for every supported platform |

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
| Cursor | `preToolUse` entries in `.cursor/hooks.json`, for `PreToolUse` guardrails whose trigger has a Cursor equivalent (below) |
| GitHub Copilot | `PreToolUse` entries in `.github/hooks/bluetemberg-guardrails.json`, for `PreToolUse` guardrails on `Bash` (below) |
| Devin Desktop (formerly Windsurf) | `PreToolUse` groups in `.devin/hooks.v1.json`, for `PreToolUse` guardrails whose trigger has a Devin equivalent (below) |
| Codex | A managed `[[hooks.PreToolUse]]` block in `.codex/config.toml`, for `PreToolUse` guardrails whose trigger has a Codex equivalent (below) |
| Gemini, Antigravity | Not yet supported — guardrails are skipped |

### Cursor

Cursor runs the same checks, and a failed check blocks the same way (exit code 2). The trigger is mapped to Cursor's tool name, and `check.field` reads Cursor's `tool_input` just as it does Claude's:

| Guardrail `trigger` (Claude Code tool) | Cursor `tool_name` |
| -------------------------------------- | ------------------ |
| `Bash` | `Shell` |

Only tools whose Cursor arguments are documented to match are mapped; Cursor documents `tool_input` for `Shell` alone. A guardrail whose trigger has no mapping (such as `EnterWorktree`, which has no Cursor equivalent) is enforced in Claude Code only, and sync says so in its output. So is a `hook_type: PostToolUse` guardrail: Cursor's `postToolUse` runs after the call and cannot block it.

Each Cursor entry sets `failClosed: true`. By default Cursor lets a call through when a hook crashes, times out or exits with a code other than 2, which would silently switch a guardrail off. Because of `failClosed`, a passing check prints `{}`: a `failClosed` hook that prints nothing counts as failed, so a silent pass would block every shell command. `{}` makes no permission decision, so it never auto-approves a command.

How `.cursor/hooks.json` is written depends on `llm/hooks.json`:

- **With `llm/hooks.json`:** sync owns the file and writes it whole, guardrail entries first, then the `llm/hooks.json` entries.
- **Without it:** sync puts the guardrail entries first and keeps every entry you wrote by hand. When the guardrails go away, sync removes only the entries it generated, and deletes the file if nothing else is left in it.

### GitHub Copilot

Copilot CLI, the Copilot cloud agent and VS Code's Copilot harness share one hook runtime, and all three load every `*.json` file in `.github/hooks/` ([GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference), [VS Code: Configure agent hooks](https://code.visualstudio.com/docs/agent-customization/hooks)). Guardrails get a file of their own there, `.github/hooks/bluetemberg-guardrails.json`, so they never share a file with hooks you wrote.

Entries use the PascalCase `PreToolUse` event. With it, Copilot reports `tool_name` as the Claude tool name (`Bash`, not `bash`) and passes the parsed tool arguments as `tool_input`, so `check.field` reads the same arguments it does for Claude Code. Each entry has `matcher: "Bash"` and a `bash` command:

| Guardrail `trigger` (Claude Code tool) | Copilot tool |
| -------------------------------------- | ------------ |
| `Bash` | `bash` (reported as `Bash`; arguments `{ command }`) |

Only `Bash` is mapped: it is the only tool whose arguments Copilot documents as matching Claude's. A guardrail on any other trigger, and any `hook_type: PostToolUse` guardrail (Copilot's `postToolUse` runs after the call and cannot deny it), is enforced in Claude Code only, and sync says so.

How the hook behaves:

- **Violated check:** exits 2 and prints `{"permissionDecision":"deny","permissionDecisionReason":"<message>"}` on stdout, which is how the message reaches the agent; the message also goes to stderr.
- **Passing check:** exits 0 with no output. Copilot reads empty output as no decision, so the call goes through its normal permission flow. The hook never returns `allow`, so it never auto-approves anything.
- **Cannot evaluate:** `jq` missing, a payload that is not JSON, a payload with no string `tool_name` (such as the camelCase `toolName`/`toolArgs` shape), or a field it cannot read exits 2 and blocks. VS Code's Local harness runs the hook for every tool (see below), so there a missing `jq` blocks every tool call, not only shell commands. Copilot also treats a crash or any other non-zero exit from a `preToolUse` command hook as a deny.
- **Other tools:** the command checks `tool_name` itself and exits 0 for anything that is not `Bash`. VS Code's older Local harness loads `.github/hooks/*.json` too but ignores `matcher`, so without this check a guardrail would run against every tool.

Limits to know about:

- **Timeouts fail open.** Copilot lets the call through when a hook times out (30 s by default), even for `preToolUse`, and there is no setting to change that. The check is a single `jq` read and a regex, so in practice it finishes well within the limit.
- **Windows is not covered.** Entries carry only a `bash` command, so Copilot on Windows (which runs the `powershell` field) does not run them. The cloud agent runs on Linux.
- **VS Code's Local harness is not covered.** It sends its own tool names, so the tool-name check skips them. Use the Copilot harness (the **Copilot** session target).
- **Running both Claude Code and Copilot targets:** Copilot CLI also reads `.claude/settings.json`, so it may run the Claude Code copy of a `Bash` guardrail as well. Both deny the same calls.
- **Folder trust:** the hooks reference says repository hooks "require workspace admission" (in its agent-scoped hooks section), so expect Copilot CLI to run them only in a folder you have trusted.

The file is written the same way as Cursor's without `llm/hooks.json`: generated entries go first, entries you add by hand to the file are kept, and the file (and an empty `.github/hooks/`) is deleted when nothing else is left in it. A file that is not valid JSON is left alone and reported as a sync error. Other files in `.github/hooks/` are never read or written.

### Devin Desktop

Devin Local, the Devin Desktop agent, shares Devin CLI's hook harness and reads project hooks from `.devin/hooks.v1.json` ([Devin hooks](https://docs.devin.ai/cli/extensibility/hooks/overview)). That file uses the Claude Code hook format, so Devin runs the same script as Claude Code: a failed check exits 2, which blocks the call, and its message goes to stderr, which Devin hands to the agent as the block reason. The trigger is mapped to Devin's tool name, and `check.field` reads Devin's `tool_input`:

| Guardrail `trigger` (Claude Code tool) | Devin `tool_name` |
| -------------------------------------- | ----------------- |
| `Bash` | `exec` |

Only `exec` is mapped: Devin documents its `tool_input` as `{ command, shell_id }`, so `check.field: command` reads the same argument as in Claude Code. Devin's other tools (`edit`, `write`, …) have no documented argument names, so a guardrail on `Edit`, `Write` or `EnterWorktree` is enforced in Claude Code only, and sync says so. Devin notes that its tool names can vary by mode, model and integrations; the matcher covers `exec` only, the shell tool name it documents. So is a `hook_type: PostToolUse` guardrail, which would run after the call.

A passing check exits 0 and prints nothing, which Devin treats as "carry on normally". The hook never prints an `approve` decision, so it never auto-approves a command. If `jq` is missing or the payload cannot be read, the hook exits 2 and blocks. Devin treats every other failure — any exit code other than 0 or 2, a timeout, or `bash` not starting at all — as a logged error that **does not block**. Devin added a `fail_closed: true` hook option in v3000.11.205, but its placement in the file is not documented yet, so sync does not emit it.

Devin loads no hooks while a workspace is in Restricted Mode, but no agent runs there either.

Sync owns only the entries it generated. Guardrail groups go first, and every group you wrote by hand is kept as it is. When the guardrails go away, sync removes only its own commands and deletes the file if nothing else is left in it. A `.devin/hooks.v1.json` that is not a valid hooks object is left untouched, and sync reports an error.

Devin also loads the `hooks` key of `.claude/settings.json` by default (`read_config_from.claude`). There, a guardrail's matcher is the Claude tool name (`Bash`), which does not match `exec`, so Devin does not run the Claude Code entries a second time.

### Codex

Codex runs the same script as Claude Code, unchanged. A failed check exits 2 with the message on stderr, which Codex treats as a block and shows to the model. A passing check exits 0 with no output, which Codex reads as "continue": it never approves the command or skips Codex's own approval prompt.

| Guardrail `trigger` (Claude Code tool) | Codex `tool_name` |
| -------------------------------------- | ----------------- |
| `Bash` | `Bash` |

Codex reports its shell tool as `Bash` with `tool_input: { "command": "<the shell command string>" }`, so `check.field: command` reads the same value it does in Claude Code. No other trigger is mapped. Codex's `apply_patch` answers to `Write`/`Edit` matchers, but it takes the whole patch as `command` rather than Claude's `file_path`, so a check written for Claude's tools would read the wrong field. Unmapped triggers and `PostToolUse` guardrails are enforced in Claude Code only, and sync says so in its output.

The entries go in a managed block in `.codex/config.toml`, between `# BEGIN BLUETEMBERG MANAGED HOOKS` and `# END BLUETEMBERG MANAGED HOOKS`, next to the managed MCP block. Everything outside the markers is yours and is kept, including your own `[[hooks.PreToolUse]]` tables. `sync --check` reports a hand-edited block as out of sync. When the guardrails go away, sync removes the block, and deletes the file if nothing else is left in it. If your config defines `hooks.PreToolUse` in a form that `[[hooks.PreToolUse]]` cannot extend (a plain array, or an inline table), sync leaves the file alone and reports an error.

What Codex requires before the hooks run:

- **Trust.** Codex loads a project's `.codex/` layer only when the project is trusted, and runs each hook only after you trust it with `/hooks` in the Codex CLI. Trust is tied to the hook's contents, so a hook that changes (a new guardrail, an edited regex, an engine upgrade that changes the script) is skipped until you trust it again. Until then the guardrail is **not enforced**.
- **Hooks on.** `[features] hooks = false` turns hooks off. Sync warns when the project config sets it; it cannot see your user-level `~/.codex/config.toml`.
- **`jq` and `bash`.** A missing `jq` blocks the call (exit 2 with its own message). Codex runs the command through your `$SHELL`, and any failure other than exit 2 fails open. That covers a timeout, a crash, a missing `bash`, or any other exit code. So does an `async` hook, which is why the entries never set `async`.

Codex never sees a guardrail limited to other platforms (`platforms: [claude]`, `[cursor]`, `[copilot]` or `[devin]`). A guardrail limited to `platforms: [codex]` compiles only for Codex.

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
