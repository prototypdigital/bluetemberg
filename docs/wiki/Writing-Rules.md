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

### `stacks` (optional)

Version-aware technology constraints. A map of **stack name → semver range** declaring which framework versions the rule applies to. At sync, the rule is emitted **only** when every named stack is present in the project *and* its detected version satisfies the range; otherwise it is hard-excluded.

```markdown
---
description: Payload 3 uses Next-native config and RSC admin.
scope: 'src/payload/**'
stacks:
  payload: '>=3 <4'
---
```

| `stacks:` value | Behavior |
| --------------- | -------- |
| (absent) | **Stack-agnostic** — applies regardless of stacks (the default). |
| `{ payload: '>=3 <4' }` | Applies only on a Payload 3.x project; a Payload-2 (or non-Payload) project never sees it. |
| `{ payload: '*' }` | Any version of Payload (name-level). |
| `{ angular: '>15 <=17' }` | Migration window — half-open ranges fall out of the same semver matching. |

Notes:

- **Version is a constraint on the rule, never part of the stack name.** There is no `payload-3` stack — there is `payload` plus a range.
- Matching coerces loose versions and includes prereleases, so `15.0.0-canary.3` satisfies `>=15`.
- When two ranges in one project both match, the **most-specific (narrowest)** range wins, deterministically.
- Invalid ranges are dropped (never an accidental match); a version resolved from a low-confidence source (a coerced `package.json` range) still applies but emits a warning — guidance is never silently dropped.
- The same field works on guardrails (`llm/guardrails/`). Pack-level `stacks` in the catalog supply coarse name-only routing; a rule's own range is the precision gate.

Run [`bluetemberg detect`](Commands#bluetemberg-detect-directory) to see the detected versions your ranges are matched against, and declare versions in the [`stacks` config field](Configuration#stacks). For the full version-aware model — detection, the gate, and the versioning strategy — see [Stacks & Versioning](Stacks).

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

Collections are defined in `src/init/presets.ts` as `RULE_COLLECTION_OVERLAYS` (rule ids and tags are resolved from the catalog by `packageName`, not declared inline). See [Contributing](Contributing) for how to add a new collection.

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

- **Be concise — apply the deletion test.** The AI reads every rule on every interaction; bloated rules get ignored. For each line ask "would removing this cause a mistake?" — if not, cut it.
- **Be actionable and imperative.** Say what to do, not what to think. "Run the formatter" beats "consider formatting".
- **Say what TO do, not only what NOT to do.** Pair every prohibition with the positive replacement ("read from `process.env`", not just "never read `.env`").
- **State the consequence.** One line on what breaks if the rule is ignored, so the model can generalize the intent.
- **Use a BAD/GOOD example.** Code blocks clarify expected behavior better than prose.
- **Scope it correctly.** A rule about Docker should scope to `Dockerfile*` or `docker-compose*`, not `**`.
- **A rule is advisory, not a guarantee.** Push non-negotiable invariants into a deterministic gate (hook/lint/CI) and let the rule explain the *why*.
- **One rule per file.** Easier to enable/disable individually, and clearer intent.
- **After creating or editing rules**, run `npx bluetemberg sync` to regenerate platform files.

The full, source-cited quality bar lives in the packs wiki: [Authoring Standards](https://github.com/prototypdigital/bluetemberg-packs/wiki/Authoring-Standards#rules--always-on-passive-context).

## Tips

- Rules live in `bluetemberg-rules-*` packages — to add or update a rule, contribute to [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs)
- If a behavior only matters for certain stacks, it belongs in a collection tagged for those profiles
- If it requires multi-step reasoning or judgment calls, it might be a [skill](Writing-Skills) instead
