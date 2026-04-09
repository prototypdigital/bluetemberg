# Writing prompt files (GitHub Copilot)

VS Code–style **prompt files** (invoked from chat, often via `/`) can live under `llm/prompts/` as Markdown. Sync copies them into **`.github/prompts/`** using Copilot’s `*.prompt.md` naming.

## Layout

```
llm/prompts/
├── README.md           # optional; not synced
├── review.md           # → .github/prompts/review.prompt.md
└── ship.prompt.md      # → .github/prompts/ship.prompt.md (name preserved)
```

- Source file **`name.md`** becomes **`name.prompt.md`** in the output directory.
- Source file **`name.prompt.md`** is copied as **`name.prompt.md`** (no double suffix).

## Format

Use normal Markdown (and frontmatter if your Copilot version supports it for prompts). See [Use prompt files in VS Code](https://code.visualstudio.com/docs/copilot/customization/prompt-files) for current product behavior.

## When sync runs

Prompts are emitted only if **`copilot`** is in `platforms`. After editing `llm/prompts/`, run `bluetemberg sync` (or your `sync:llm-config` script).
