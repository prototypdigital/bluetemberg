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

Rules ship inside `bluetemberg-rules-*` npm packages, not as local templates. The wizard lets users select which **collections** (packages) to install; individual rule selection is not supported.

| Tier | Behavior | When to use |
| ---- | -------- | ----------- |
| **Collection default** | Collection is pre-checked for tagged profiles | The collection's rules are broadly useful for that team type |
| **Collection optional** | Collection is available but not pre-checked | Specialized rules that only apply to certain stacks |

Collections are defined in `src/init/presets.ts` as `RULE_COLLECTION_PRESETS`. See [Contributing](Contributing) for how to add a new collection.

## Naming convention

- Use **kebab-case** for filenames: `coding-standards.md`, `no-console-log.md`
- The filename (minus `.md`) becomes the output filename stem across all platforms

## Available rule collections

Rules are grouped into collections. For the full list of individual rules inside each pack, see the [Catalog](https://github.com/prototypdigital/bluetemberg-packs/wiki/Catalog) in the bluetemberg-packs wiki.

| Collection | Package | Profiles | Contents |
| ---------- | ------- | -------- | -------- |
| TypeScript | `bluetemberg-rules-typescript` | Frontend, Backend, Full-stack | `type-safety`, `coding-standards`, `early-returns`, `no-console-log`, `design-system-reuse` |
| Git | `bluetemberg-rules-git` | All except Custom | `git-workflow`, `git-move`, `pre-commit-checks` |
| Security | `bluetemberg-rules-security` | All except Custom | `never-read-env`, `security-secrets`, `api-error-handling` |
| Docs | `bluetemberg-rules-docs` | All except Custom | `docs-parity`, `post-edit-diagnostics`, `mermaid-diagrams` |
| DevOps | `bluetemberg-rules-devops` | DevOps, Pure Infra | Docker, Ansible, K8s, Terraform, CI/CD, idempotency, runbooks |
| Next.js | `bluetemberg-rules-nextjs` | Frontend, Full-stack | `nextjs-public-env-vars` |

## Writing a good rule

- **Be concise.** The AI reads every rule on every interaction. Long rules waste context.
- **Be actionable.** Say what to do, not what to think. "Run the formatter" beats "consider formatting".
- **Use examples.** Code blocks clarify expected behavior better than prose.
- **Scope it correctly.** A rule about Docker should scope to `Dockerfile*` or `docker-compose*`, not `**`.
- **One rule per file.** Easier to enable/disable individually, and clearer intent.
- **After creating or editing rules**, run `npx bluetemberg sync` to regenerate platform files.

## Tips

- Rules live in `bluetemberg-rules-*` packages — to add or update a rule, contribute to [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs)
- If a behavior only matters for certain stacks, it belongs in a collection tagged for those profiles
- If it requires multi-step reasoning or judgment calls, it might be a [skill](Writing-Skills) instead
