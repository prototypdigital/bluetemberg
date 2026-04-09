# Adapters and sync extensions

Bluetemberg’s sync engine runs a **pipeline of steps**: vendor-neutral sources under `llm/` are read first; built-in steps validate, normalize, and write provider-specific files through one write helper (`commitPlannedWrite`). Rules use the **transform + copy** path (frontmatter mapping). Steps that need different shapes (MCP JSON, Cursor hooks, Claude commands, Copilot prompt filenames) are separate pipeline stages. You can extend the end of the run with optional **`adapters`** in `bluetemberg.config.json` (ESM modules loaded via `import()`), similar in spirit to small plug-in hooks.

## Trust and security (`adapters`)

Each entry in `adapters` is a module specifier executed with Node’s `import()`. That runs **third-party or local code** during sync. Only add packages or `file:` paths you trust, keep them pinned, and treat changes to `bluetemberg.config.json` like any other sensitive config in code review and CI.

## What is implemented today

| Source | Output | When it runs |
| ------ | ------ | ------------ |
| `llm/rules/` | Cursor / Claude / Copilot rule files | Always (per `targets` + `platforms`) |
| `llm/agents/`, `llm/skills/` | Claude / Copilot paths | When configured |
| `AGENTS.md` | `.github/copilot-instructions.md` | When file exists |
| `llm/mcp.json` | `.claude/mcp.json`, `.github/mcp.json`, `.cursor/mcp.json` | When file exists and each platform is enabled |
| `llm/hooks.json` | `.cursor/hooks.json` | When file exists and **cursor** is in `platforms` |
| `llm/commands/*.md` | `.claude/commands/*.md` | When files exist and **claude** is in `platforms` |
| `llm/prompts/*.md` | `.github/prompts/*.prompt.md` | When files exist and **copilot** is in `platforms` |
| `adapters` in config | User-defined ESM modules (last sync step) | When `adapters` is a non-empty array of specifiers |

Nothing runs your hooks or MCP at sync time: the CLI only writes files. `sync --check` diffs the same outputs.

## Optional npm / file adapters

`bluetemberg.config.json` may include `"adapters": ["my-package", "file:./tools/btg-adapter.mjs"]`. Each specifier is passed to `import()`. The module must **`export default`** either:

- a **function** `(ctx, recordError) => void | Promise<void>`, or
- an object with a **`run`** method of that shape.

Use the **`AdapterContext`** type from `@prototypdigital/bluetemberg` (or `@prototypdigital/bluetemberg/sync/adapter-contract`). For drift-safe writes inside an adapter, import **`commitPlannedWrite`** from `@prototypdigital/bluetemberg/sync/pipeline` so `--check` stays accurate.

The programmatic **`sync()`** API is **async** (it `await`s adapter modules).

## Design principles

- **Vendor-neutral sources** — Prefer plain Markdown or JSON in `llm/` so the repo stays useful without Bluetemberg.
- **Deterministic output** — Same inputs produce the same files; CI can gate on `--check`.
- **Platform gates** — If a platform is not listed in `platforms`, its adapter does not emit files (no surprise `.cursor` output when the team only uses Claude).

## Roadmap (optional follow-ups)

- Richer validation for Cursor hook event names as Cursor’s schema stabilizes.
- First-party adapter presets shipped as optional npm packages.

See [Architecture](Architecture) for the high-level init/sync flow and [Configuration](Configuration) for `bluetemberg.config.json`.
