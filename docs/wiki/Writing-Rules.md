# Writing Rules

Rules live in `llm/rules/` as Markdown files with YAML frontmatter. They are the always-on, passive context that AI assistants see on every interaction.

## Format

```markdown
---
description: Short description of what this rule enforces.
scope: '**'
---

# Rule Title

Rule content in Markdown. This is what the AI assistant sees.
```

## Frontmatter fields

### `description` (required)

A one-line description of the rule. Used as metadata in all platform outputs.

### `scope` (optional, default: `'**'`)

Controls which files the rule applies to.

| Value                  | Meaning                                 |
| ---------------------- | --------------------------------------- |
| `'**'`                 | Global — applies to all files           |
| `'src/**'`             | Applies only to files matching the glob |
| `['src/**', 'lib/**']` | Multiple glob patterns                  |

## How scope is transformed

The sync engine converts `scope` into platform-specific frontmatter:

| Source scope       | Cursor                    | Claude                    | Copilot                |
| ------------------ | ------------------------- | ------------------------- | ---------------------- |
| `'**'`             | `alwaysApply: true`       | `paths: ['**']`           | `applyTo: '**'`        |
| `'src/**'`         | `globs: ['src/**']`       | `paths: ['src/**']`       | `applyTo: 'src/**'`    |
| `['a/**', 'b/**']` | `globs: ['a/**', 'b/**']` | `paths: ['a/**', 'b/**']` | `applyTo: 'a/**,b/**'` |

## Rule tiers

Not all rules are equal. Bluetemberg has three intent levels:

| Tier | Behavior | When to use |
| ---- | -------- | ----------- |
| **Universal** | Always included, cannot be deselected in the wizard | Hard requirements that every project needs — formatting, linting, security baselines |
| **Team default** | Pre-checked for tagged profiles, deselectable | Strong recommendations for a team type — `type-safety` for frontend/backend |
| **Team optional** | Off by default, opt-in | Specialized rules that only apply to certain stacks — `terraform-conventions`, `docker-best-practices` |

Universal rules are marked `universal: true` in `src/init/presets.ts`. See [Contributing](Contributing) for how to add or promote rules.

## Naming convention

- Use **kebab-case** for filenames: `coding-standards.md`, `no-console-log.md`
- The filename (minus `.md`) becomes the output filename stem across all platforms

## Available starter rules

| Rule | Scope | Tier | Tags | Description |
| ---- | ----- | ---- | ---- | ----------- |
| `coding-standards` | `**` | Universal | all | Function complexity, readability, naming conventions |
| `early-returns` | `**` | Universal | all | Guard clauses over nested conditionals |
| `git-move` | `**` | Universal | all | Use `git mv` for tracked files to preserve history |
| `never-read-env` | `**` | Universal | all | Never read `.env` files directly in code |
| `post-edit-diagnostics` | `**` | Universal | frontend, backend, fullstack | Run diagnostics and formatter after editing code files |
| `pre-commit-checks` | `**` | Universal | all | Formatter, linter, and build pass before every commit |
| `docs-parity` | `**` | Universal | all | Doc updates ship in the same commit as behavior changes |
| `type-safety` | `**` | Default | frontend, backend, fullstack | No `any`, no unguarded assertions, prefer `unknown` |
| `no-console-log` | `src/**` | Optional | backend, fullstack | Forbid `console.*` in production code, use logger |
| `design-system-reuse` | `**` | Optional | frontend, fullstack | Reuse shared UI components and tokens |
| `api-error-handling` | `**` | Optional | backend, fullstack | Structured error responses, never leak stack traces |
| `security-secrets` | `**` | Optional | backend, fullstack, devops | Never hardcode secrets, tokens, or credentials |
| `docker-best-practices` | `**` | Optional | devops | Multi-stage builds, non-root users, layer caching |
| `terraform-conventions` | `**` | Optional | devops | Module structure, naming, state management |

## Writing a good rule

- **Be concise.** The AI reads every rule on every interaction. Long rules waste context.
- **Be actionable.** Say what to do, not what to think. "Run the formatter" beats "consider formatting".
- **Use examples.** Code blocks clarify expected behavior better than prose.
- **Scope it correctly.** A rule about Docker should scope to `Dockerfile*` or `docker-compose*`, not `**`.
- **One rule per file.** Easier to enable/disable individually, and clearer intent.
- **After creating or editing rules**, run `npx bluetemberg sync` to regenerate platform files.

## Tips

- If a behavior must happen on every project, it should probably be a universal rule — talk to the maintainers
- If a behavior only matters for certain stacks, tag it for the relevant profiles
- If it requires multi-step reasoning or judgment calls, it might be a [skill](Writing-Skills) instead
