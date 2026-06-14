# Claude Code Marketplace

Bluetemberg can emit a **Claude Code plugin marketplace** bundle alongside (or instead of) the standard flat output. This lets teams distribute their rules, agents, and skills as installable plugins that teammates can add with `/plugin marketplace add owner/repo`.

## Enabling marketplace output

Add `"claude-marketplace"` to `platforms` in `bluetemberg.config.json`:

```json
{
  "platforms": ["claude", "claude-marketplace"],
  "source": "llm",
  "marketplace": {
    "plugins": [
      { "name": "my-project", "displayName": "My Project" }
    ]
  }
}
```

Running `bluetemberg sync` then produces:

```
.claude-plugin/
└── marketplace.json
plugins/
└── my-project/
    ├── .claude-plugin/plugin.json
    ├── rules/
    │   └── {rule-id}.md
    ├── skills/
    │   └── {skill-id}/SKILL.md
    └── agents/
        └── {agent-id}.md
```

## Dedicated marketplace repo (Option A)

The recommended setup keeps product repos clean by publishing marketplace output to a **separate dedicated repo** — `prototypdigital/claude-marketplace`. Bluetemberg generates the output locally; a CI workflow pushes it to the marketplace repo on every merge to `main`.

### Why a dedicated repo

- Product repos don't get cluttered with `plugins/` and `.claude-plugin/` directories
- Claude Desktop points at one stable URL regardless of which product repo changed
- The marketplace repo acts as a single source of truth for plugin distribution across all team projects

### Setup

**1. Add `remote` to `bluetemberg.config.json`:**

```json
{
  "platforms": ["claude", "claude-marketplace"],
  "marketplace": {
    "remote": "prototypdigital/claude-marketplace",
    "plugins": [{ "name": "my-project", "displayName": "My Project" }]
  }
}
```

When `remote` is set, `bluetemberg sync` automatically adds `prototypdigital/claude-marketplace` to `extraKnownMarketplaces` in `.claude/settings.json`. This causes Claude Desktop to auto-prompt teammates to install plugins when they open the project folder.

**2. Add `MARKETPLACE_PUSH_TOKEN` and `MARKETPLACE_REPO` to your repo:**

- Go to **Settings → Secrets and variables → Actions**
- Add secret `MARKETPLACE_PUSH_TOKEN`: a GitHub PAT (or fine-grained token) with `contents: write` on the marketplace repo
- Add variable `MARKETPLACE_REPO`: `prototypdigital/claude-marketplace`

**3. Scaffold the workflow:**

`bluetemberg init` writes `.github/workflows/sync-marketplace.yml` automatically when `claude-marketplace` is selected. For existing projects, re-run `bluetemberg init` (it preserves your config) or add the workflow by hand — the generated file is plain GitHub Actions YAML with no bluetemberg-specific magic.

The workflow triggers on pushes to `main` that touch `llm/**` or `bluetemberg.config.json`, runs `bluetemberg sync`, then commits and pushes `plugins/` and `.claude-plugin/` to the marketplace repo.

### `.claude/settings.json`

When `remote` is configured, every `bluetemberg sync` run ensures `.claude/settings.json` contains:

```json
{
  "extraKnownMarketplaces": ["prototypdigital/claude-marketplace"]
}
```

Existing settings keys are preserved. The entry is only added once — if already present, the file is not modified.

## The `marketplace` config key

Defined under `blueprintconfig.marketplace`. Controls how `llm/` content maps to installable plugins.

### `remote` field

`owner/repo` shorthand for the dedicated marketplace repo. When set:
- `extraKnownMarketplaces` is written to `.claude/settings.json` on every sync
- The scaffolded CI workflow uses `${{ vars.MARKETPLACE_REPO }}` to push output there

### `plugins` array

Each entry in `plugins` becomes one installable plugin in the marketplace:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Plugin identifier; used as the directory name under `plugins/` |
| `displayName` | string | no | Human-readable name shown in Claude Desktop |
| `description` | string | no | Short description shown in Claude Desktop |
| `profiles` | `TeamProfile[]` | no | Filter content by team profile tags (see [Profile filtering](#profile-filtering)) |

When `plugins` is omitted entirely, bluetemberg emits a single plugin named after the project directory containing all `llm/` skills and agents.

### Full example

```json
{
  "platforms": ["claude", "claude-marketplace"],
  "source": "llm",
  "marketplace": {
    "plugins": [
      {
        "name": "frontend",
        "displayName": "Frontend Developer",
        "description": "Rules, agents, and skills for React/TypeScript projects",
        "profiles": ["frontend", "fullstack"]
      },
      {
        "name": "devops",
        "displayName": "DevOps Engineer",
        "description": "Infrastructure, CI/CD, and Kubernetes tooling",
        "profiles": ["devops", "pure-infra"]
      }
    ]
  }
}
```

## Profile filtering

When a plugin definition includes a `profiles` array, only `llm/` files matching at least one of those profiles are included in that plugin. This applies to **rules, skills, and agents**.

**Resolution order:**
1. If the file has a `profiles:` frontmatter field, that value is used.
2. If no frontmatter field is present but the file's id (directory/basename) appears in the **catalog** (`catalog.json`), the owning pack's profiles are used (a `universal` pack contributes no profiles → universal).
3. If neither applies (e.g. a local project rule not shipped by any pack), the file is treated as **universal** — included in every plugin regardless of profile filters.

The catalog is the single source of truth for this mapping — the engine no longer hand-maintains a preset→profile table, so a pack file can never silently leak into the wrong plugin because its id was missing from the engine.

```yaml
# llm/rules/type-safety.md
---
description: Enforce strict type safety — no implicit any, no unguarded assertions.
scope: "**"
profiles:
  - frontend
  - backend
  - fullstack
---
```

```yaml
# llm/skills/api-design/SKILL.md
---
name: API Design
description: REST and GraphQL patterns
profiles:
  - backend
  - fullstack
---
```

With the config above, `api-design` would appear in the `frontend` plugin only if `backend` or `fullstack` overlap with `["frontend", "fullstack"]` — which `fullstack` does, so it is included.

A plugin with **no `profiles` field** always includes everything (no filtering).

## Output files

### `plugins/{name}/.claude-plugin/plugin.json`

Per-plugin manifest listing all included skills and agents:

```json
{
  "name": "frontend",
  "displayName": "Frontend Developer",
  "description": "...",
  "rules": [
    {
      "name": "coding-standards",
      "description": "Keep functions and components small, readable, and easy to reason about.",
      "path": "plugins/frontend/rules/coding-standards.md"
    }
  ],
  "skills": [
    {
      "name": "Patterns",
      "description": "Reusable architecture patterns",
      "path": "plugins/frontend/skills/patterns/SKILL.md"
    }
  ],
  "agents": [
    {
      "name": "frontend-specialist",
      "description": "...",
      "path": "plugins/frontend/agents/frontend-specialist.md"
    }
  ]
}
```

### `.claude-plugin/marketplace.json`

Root manifest listing all plugins in this marketplace:

```json
{
  "name": "my-project",
  "plugins": [
    { "name": "frontend", "description": "...", "path": "plugins/frontend" },
    { "name": "devops", "description": "...", "path": "plugins/devops" }
  ]
}
```

## Claude hooks bundling

When `llm/claude-hooks.json` exists in any source directory, its contents are bundled into every plugin as `plugins/{name}/hooks/hooks.json`. The same file is referenced in `plugin.json` under the `hooks` key.

```
plugins/
└── my-project/
    ├── .claude-plugin/plugin.json   ← includes "hooks": "plugins/my-project/hooks/hooks.json"
    └── hooks/
        └── hooks.json              ← copied from llm/claude-hooks.json
```

**Note:** The source file is `claude-hooks.json` (not `hooks.json`) to avoid conflict with Cursor's `llm/hooks.json`. Hooks are plugin-level — the same file goes to every plugin with no profile filtering.

When the source file is absent, no `hooks/` directory is created and the `hooks` field is omitted from `plugin.json`.

## Stale output pruning

`bluetemberg sync --prune` cleans up marketplace outputs that are no longer generated. It scans `plugins/` and `.claude-plugin/` and removes:

- Rules, skills, agents, `hooks.json`, and `plugin.json` files belonging to plugins that no longer exist or contain that file
- `marketplace.json` if the platform is removed

This requires `"claude-marketplace"` to remain in `platforms` when pruning. To remove all marketplace output, temporarily keep the platform listed, run `sync --prune`, then remove it from `platforms`.

## Flat output and marketplace together

Both emitters can run in the same sync pass:

```json
{
  "platforms": ["claude", "claude-marketplace"]
}
```

The flat output goes to `.claude/` as usual; the marketplace output goes to `plugins/` and `.claude-plugin/`. There is no duplication of source reads — the same merged source directories feed both.

## Modern skill frontmatter fields

Skills are copied verbatim from `llm/skills/` to `plugins/{name}/skills/`. All frontmatter fields pass through unchanged, including Claude-specific fields:

| Field | Purpose |
|-------|---------|
| `disable-model-invocation` | Prevents Claude from auto-triggering the skill |
| `allowed-tools` | Pre-approves tool access for the skill |
| `context: fork` | Runs the skill in a subagent context |
| `hooks` | Skill-scoped hook lifecycle |

These are no-ops for Cursor and Copilot emitters but propagate correctly when the source file contains them.
