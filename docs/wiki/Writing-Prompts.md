# Writing prompt files (GitHub Copilot)

> **Deprecated output.** VS Code runs prompt files only in its Local harness and recommends migrating them to skills ([VS Code 1.129](https://code.visualstudio.com/updates/v1_129)). Sync now also writes every prompt as a generated skill to each skills target, and the `.github/prompts/` output is kept for a transition period only: it stops being written in 0.18.0. New work belongs in [`llm/skills/`](Writing-Skills). See [Migrating commands and prompts](Writing-Skills#migrating-commands-and-prompts).

VS Code–style **prompt files** (invoked from chat via `/`) can live under `llm/prompts/` as Markdown. Sync writes each one twice:

- to **`.github/prompts/`** using Copilot’s `*.prompt.md` naming. Deprecated; see the removal plan.
- as a generated skill, `<skills dir>/<name>/SKILL.md`, to every skills target of the enabled platforms (`.github/skills/`, `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`). Copilot shows skills as `/name` slash commands too.

## Layout

```
llm/prompts/
├── README.md           # optional; not synced
├── review.md           # → .github/prompts/review.prompt.md + <skills dir>/review/SKILL.md
└── ship.prompt.md      # → .github/prompts/ship.prompt.md   + <skills dir>/ship/SKILL.md
```

- Source file **`name.md`** becomes **`name.prompt.md`** in the output directory.
- Source file **`name.prompt.md`** is copied as **`name.prompt.md`** (no double suffix).
- The skill is named after the file without `.md` and `.prompt`, or after the prompt's own `name` field when it has one, since that is what VS Code put after the `/`.

## Format

Use normal Markdown with optional frontmatter. See [Prompt files in VS Code](https://code.visualstudio.com/docs/agent-customization/prompt-files) for current product behavior.

The generated skill keeps `description` and `argument-hint`, and adds `disable-model-invocation: true` so it stays user-invoked, as VS Code's own migration does. A prompt's `agent`, `mode`, `model` and `tools` have no skill equivalent: they stay in the `.prompt.md` output, are left out of the skill, and sync warns. For a fixed agent, model or tool set, write a [custom agent](Writing-Agents) instead.

The skill name must be valid (lowercase letters, digits and single hyphens, at most 64 characters). Otherwise sync warns and writes only the `.prompt.md` file.

## When sync runs

The `.github/prompts/` output is written only if **`copilot`** is in `platforms`. The generated skill is written for every enabled platform that has a skills target. After editing `llm/prompts/`, run `bluetemberg sync` (or your `sync:llm-config` script). Prompts are read from the project's own `llm/` only.

A real skill (`llm/skills/<name>/`) or a command of the same name wins over a prompt; sync warns.

During the transition both the `.prompt.md` file and the generated skill exist, so VS Code's Local harness may list `/name` twice. Copilot harness sessions do not load prompt files at all, only the skill. Moving the prompt into `llm/skills/` ends the overlap.
