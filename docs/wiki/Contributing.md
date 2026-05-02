# Contributing

## Development setup

```bash
git clone https://github.com/prototypdigital/bluetemberg.git
cd bluetemberg
npm install
npm run build
npm test
```

`bin/cli.js` loads compiled modules from `dist/` (for example preset validation constants, **`init`**, and **`--help --json`**). After a clean clone or when TS sources change, run **`npm run build`** before invoking the CLI from the repo root.

## Scripts

| Script                 | Purpose                       |
| ---------------------- | ----------------------------- |
| `npm run build`        | Compile TypeScript to `dist/` |
| `npm run dev`          | Watch mode compilation        |
| `npm test`             | Run tests (vitest)            |
| `npm run test:watch`   | Watch mode tests              |
| `npm run lint`         | ESLint check                  |
| `npm run lint:fix`     | ESLint auto-fix               |
| `npm run format`       | Prettier format               |
| `npm run format:check` | Prettier check                |
| `npm run typecheck`    | TypeScript type check         |

## Sync CLI and CI (downstream consumers)

When documenting or integrating `bluetemberg sync`: the process **exit code** is the source of truth for success or failure. If a script uses **`--silent`**, it must still check the exit status (e.g. `$?` in shell); suppressed logs do not mean the run succeeded. See [Commands — Exit codes](Commands#exit-codes).

## Project structure

```
src/
├── index.ts              # Public API exports
├── types.ts              # Shared TypeScript interfaces
├── utils/
│   └── fs.ts             # File system helpers
├── sync/
│   ├── index.ts           # Sync engine orchestration (async; optional adapters)
│   ├── transform.ts       # Rule frontmatter transform
│   ├── pipeline.ts        # commitPlannedWrite / check-mode counting
│   ├── mcp.ts             # llm/mcp.json → Claude / Copilot / Cursor
│   ├── hooks.ts           # llm/hooks.json → Cursor
│   ├── commands.ts        # llm/commands → Claude
│   ├── prompts.ts         # llm/prompts → Copilot *.prompt.md
│   ├── adapters-runner.ts # Optional config.adapters dynamic import
│   └── adapter-contract.ts# AdapterContext types
├── mcp/
│   └── registry.ts        # Built-in MCP server presets
└── init/
    ├── index.ts           # Init wizard orchestrator
    ├── init-catalog.ts    # Allowed profile/platform/package-manager values (CLI + `--config` validation)
    ├── prompts.ts         # Inquirer prompt definitions
    ├── presets.ts         # Available rule/agent/skill presets
    └── scaffold.ts        # File generation logic
```

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All PR titles must follow the format:

```
type(scope): description
```

Common types:

- `feat` — new feature (triggers minor version bump)
- `fix` — bug fix (triggers patch version bump)
- `docs` — documentation only
- `chore` — maintenance, dependencies
- `refactor` — code change that neither fixes a bug nor adds a feature

Breaking changes: add `!` after the type, e.g. `feat!: remove sync v1 API`. This triggers a major version bump (or minor while pre-1.0).

## Pull request process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all checks pass: `npm run build && npm test && npm run lint && npm run format:check`
4. Open a PR with a conventional commit title
5. CODEOWNERS will be auto-requested for review
6. After merge, Release Please will open/update a release PR
7. When the release PR is merged, the package is published automatically

## Release process

Releases are fully automated via [Release Please](https://github.com/googleapis/release-please):

1. Conventional commits on `main` are analyzed
2. A "release PR" is opened with version bump and CHANGELOG update
3. A maintainer reviews and merges the release PR
4. A GitHub Release is created automatically
5. The publish workflow triggers and pushes to GitHub Packages

No manual version bumping or tagging is needed.

### Changelog and breaking changes

- **Do not add a `## [Unreleased]` section** (or other manual top-of-file draft entries) to `CHANGELOG.md`. [Release Please](https://github.com/googleapis/release-please) updates `CHANGELOG.md` on the release PR from your **conventional commits**; a hand-maintained block duplicates or fights that flow.
- **Breaking changes** belong in commit metadata: use a `feat!:` / `fix!:` / `chore!:` title, and/or a `BREAKING CHANGE:` paragraph in the commit **body**, per [Conventional Commits](https://www.conventionalcommits.org/). Release Please turns those into the correct version bump and changelog section.
- Use the **PR description** for extra context (migration notes, links); consumers still read the generated changelog after release.
- **Do not edit** `CHANGELOG.md` on feature PRs to “pre-document” the next version—let the release PR carry the authoritative diff.

---

## Adding a rule template

Rules are always-on, passive context. See [Writing Rules](Writing-Rules) for format details.

### 1. Create the template file

Add a Markdown file to `templates/rules/`:

```markdown
---
description: One-line description of what this rule enforces.
scope: '**'
---

# Rule title

Concise, actionable content the AI sees on every interaction.
```

### 2. Add a preset entry

In `src/init/presets.ts`, add an entry to the `RULE_PRESETS` array:

```ts
{
  id: 'my-new-rule',            // must match the filename (minus .md)
  name: 'My new rule',          // displayed in the wizard
  description: 'What it does',  // shown next to the name
  default: false,               // true = pre-checked for tagged profiles
  tags: ['backend', 'fullstack'],  // which profiles pre-check this rule
},
```

### 3. Update the docs

Add the rule to the table in [Writing Rules](Writing-Rules) and to any affected profile tables in [Profiles](Profiles). The `docs-parity` universal rule requires this — PRs that add templates without updating docs are not considered complete.

### 4. Test and open a PR

```bash
npm run build && npm test
```

Try it locally in a throwaway directory:

```bash
mkdir /tmp/test-project && cd /tmp/test-project
npm init -y
node /path/to/bluetemberg/bin/cli.js init
```

Open a PR with title: `feat: add <name> rule template`

## Adding an agent template

Agents are specialist AI personas. See [Writing Agents](Writing-Agents) for format details.

### 1. Create the template file

Add a Markdown file to `templates/agents/`:

```markdown
---
name: my-agent
description: One-line description.
tools: ['read', 'search', 'edit']
---

# My Agent

You are a [role] specialist. Your job is to [responsibility].

## Responsibilities

- ...

## Constraints

- ...
```

### 2. Add a preset entry

In `src/init/presets.ts`, add to `AGENT_PRESETS`:

```ts
{
  id: 'my-agent',
  name: 'My agent',
  description: 'What it does',
  default: false,
  tags: ['backend', 'fullstack'],
},
```

### 3. Update docs and open a PR

Add the agent to tables in [Writing Agents](Writing-Agents) and [Profiles](Profiles). PR title: `feat: add <name> agent template`

## Adding a skill template

Skills are on-demand, multi-step workflows. See [Writing Skills](Writing-Skills) for format details and when to use a skill vs a rule.

### 1. Create the template directory

```
templates/skills/my-skill/SKILL.md
```

### 2. Add a preset entry

In `src/init/presets.ts`, add to `SKILL_PRESETS`:

```ts
{
  id: 'my-skill',
  name: 'My skill',
  description: 'What it does',
  default: false,
  tags: ['backend', 'fullstack'],
},
```

### 3. Update docs and open a PR

Add the skill to tables in [Writing Skills](Writing-Skills) and [Profiles](Profiles). PR title: `feat: add <name> skill template`

## Adding a team profile

Profiles set smart defaults for the init wizard. Adding a new one is a code change.

### 1. Add the profile ID to the type union

In `src/types.ts`:

```ts
export type TeamProfile = 'frontend' | 'backend' | 'fullstack' | 'devops' | 'my-profile' | 'custom';
```

### 2. Add the profile entry

In `src/init/presets.ts`, add to `TEAM_PROFILES`:

```ts
{ id: 'my-profile', name: 'My Profile', description: 'Short description of the team type' },
```

### 3. Tag existing presets

Add `'my-profile'` to the `tags` array of every rule, agent, and skill that should be pre-checked for this profile.

### 4. Update docs

Add a new section to [Profiles](Profiles) with the rules/agents/skills matrix. Add the profile to the description in the [Commands](Commands) page.

### 5. Open a PR

PR title: `feat: add <name> team profile`

## How tags and universal work

Every preset has a `tags` array listing which profiles consider it a default:

```ts
tags: ['frontend', 'backend', 'fullstack']
```

When a user picks a profile, every preset tagged for that profile gets pre-checked in the wizard. The `custom` profile skips tag-based defaults — nothing is pre-checked.

The `universal` flag overrides everything:

```ts
universal: true   // always selected, shown as "(required)", cannot be deselected
```

Universal presets are included regardless of profile, even `custom`. Use this sparingly — only for hard requirements that every project needs. Currently 7 rules are universal. No agents or skills are universal.

## The docs-parity rule

Bluetemberg enforces a `docs-parity` universal rule: documentation must ship in the same commit as every user-facing change. This applies to the tool itself.

When your PR changes behavior — a new template, a new flag, a config schema change — update the relevant wiki pages in `docs/wiki/` as part of the same commit. CI won't catch a missing doc update, but code reviewers will, and the rule exists to remind you.
