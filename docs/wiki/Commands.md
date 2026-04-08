# Commands

## `blueprint init [directory]`

Interactive wizard that scaffolds AI tooling into a project.

**Arguments:**

- `directory` — target directory (default: current directory)

**What it does:**

1. Asks you to pick platforms, rules, agents, skills, and MCP servers
2. Creates `llm/` directory with selected starter content
3. Generates `blueprint.config.json`
4. Creates `AGENTS.md` and `CLAUDE.md` (if Claude selected)
5. Sets up MCP config files (if selected)
6. Adds `sync:llm-config` scripts to `package.json`
7. Runs an initial sync to generate all platform-specific files

**Example:**

```bash
npx @prototypdigital/blueprint init
npx @prototypdigital/blueprint init ./my-project
```

## `blueprint sync [directory]`

Reads vendor-neutral sources from `llm/` and generates platform-specific files.

**Arguments:**

- `directory` — project root directory (default: current directory)

**Options:**

- `--check` — dry-run mode; exits with code 1 if any generated files are out of sync

**Example:**

```bash
npx blueprint sync
npx blueprint sync --check
npx blueprint sync ./my-project
```

**When to run:**

- After creating or editing any file in `llm/rules/`, `llm/agents/`, or `llm/skills/`
- In CI to verify generated files haven't drifted

## Package scripts

After running `init`, these scripts are added to your `package.json`:

| Script                  | Command                      |
| ----------------------- | ---------------------------- |
| `sync:llm-config`       | `npx blueprint sync`         |
| `sync:llm-config:check` | `npx blueprint sync --check` |
