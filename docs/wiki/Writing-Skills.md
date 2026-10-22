# Writing Skills

Skills live in `llm/skills/<skill-name>/SKILL.md`. Each skill is a directory containing a single `SKILL.md` file.

## Rules vs Skills

Rules and skills serve different purposes:

| | Rules | Skills |
| --- | ----- | ------ |
| **When active** | Always-on, passive context | On-demand, invoked explicitly |
| **What they do** | Set constraints and standards | Define multi-step workflows |
| **How they're read** | Every interaction | Only when triggered |
| **Example** | "Run the formatter before committing" | "Audit this PR for security issues" |

Use a **rule** when the behavior should happen automatically on every interaction. Use a **skill** when the behavior requires judgment, multiple steps, or is only relevant in specific situations.

## Format

Skills follow the **deep-skill standard** — a step-by-step protocol the model can execute, not a restatement of what a base model already knows:

````markdown
---
name: skill-name
description: One tight sentence — what the skill does and when.
---

# skill-name

Use this skill when [trigger context].

## Triggers

- "trigger phrase or measurable condition"
- "a second concrete trigger"

## Protocol

### Step 1 — {imperative action}

Use a decision tree wherever a branch matters:

```text
Does {condition} hold?
  YES → {path A}
  NO  → {path B}
```

### Step 2 — {imperative action}

```text
BAD:  {the wrong form — concrete code/command/output}
GOOD: {the corrected form}
```

## Completion checklist

- [ ] {verifiable criterion}
- [ ] {verifiable criterion}

## When NOT to use

- {Situation where this skill is the wrong tool or adds noise}
````

## Frontmatter fields

### `name` (required)

Matches the directory name. Kebab-case.

### `description` (required)

One-line description of the skill's purpose.

## How skills are synced

A skill is a directory, and the whole directory is synced. `SKILL.md` is copied with its content unchanged apart from the generated-file banner added after the frontmatter. Every other file in the directory — the `scripts/`, `references/` and `assets/` the [Agent Skills](https://agentskills.io) layout allows, or anything else you put there — is copied byte for byte with its file mode kept, so a script that is executable in `llm/` is executable in the output. Supporting files get no banner. Dotfiles are skipped.

| Source                                 | Cursor                                     | Claude                                     | Copilot                                    |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| `llm/skills/patterns/SKILL.md`         | `.cursor/skills/patterns/SKILL.md`         | `.claude/skills/patterns/SKILL.md`         | `.github/skills/patterns/SKILL.md`         |
| `llm/skills/patterns/scripts/check.sh` | `.cursor/skills/patterns/scripts/check.sh` | `.claude/skills/patterns/scripts/check.sh` | `.github/skills/patterns/scripts/check.sh` |

Reference supporting files from `SKILL.md` by their path relative to the skill directory (`scripts/check.sh`), which is the same in the source and in every output. The same copy happens for marketplace plugin skills under `plugins/<name>/skills/`.

`sync --check` compares supporting files byte for byte. `sync --prune` treats a skill directory as one unit: when its `SKILL.md` carries the banner, a supporting file that no longer exists in the source is removed, and so is the whole directory once the skill itself is gone.

## Naming convention

- Each skill is a **directory** containing `SKILL.md`
- Directory name should be **kebab-case**: `docs-upkeep`, `workspace-hygiene`

## Official skill packages

Official skills ship as `bluetemberg-skills-*` packages from [prototypdigital/bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). The init wizard writes the `llm/packages.json` manifest; run `bluetemberg install` to download them.

| Package | Tags | Description |
| ------- | ---- | ----------- |
| `bluetemberg-skills-patterns` | frontend, backend, fullstack | Apply reusable architecture and coding patterns |
| `bluetemberg-skills-docs-upkeep` | all | Keep docs aligned with implementation changes |
| `bluetemberg-skills-workspace-hygiene` | all | On-demand workspace audit — review change scope, clean temp artifacts |
| `bluetemberg-skills-react-patterns` | frontend, fullstack | Component composition, hook extraction, and state co-location for React projects |
| `bluetemberg-skills-code-review` | frontend, backend, fullstack | Structured review checklist for PRs |
| `bluetemberg-skills-api-design` | backend, fullstack | RESTful conventions, pagination, versioning |
| `bluetemberg-skills-security-audit` | backend, fullstack, devops | Dependency audit, secrets scan, OWASP patterns |
| `bluetemberg-skills-ci-cd-best-practices` | devops | Pipeline optimization, caching strategies |
| `bluetemberg-skills-migration-safety` | backend, fullstack | Database migration review, rollback plans |
| `bluetemberg-skills-stack-change-review` | devops | High-blast-radius infrastructure change review |
| `bluetemberg-skills-infrastructure-drift-check` | devops | Verify declared IaC state matches deployed state before merge |
| `bluetemberg-skills-rollback-plan` | devops | Require tested rollback steps for every production change |

You can also write custom local skills directly in `llm/skills/` — local files always take priority over package content.

## Writing a good skill

The bar is a procedure the model can *execute*, not a list of platitudes a base model already follows.

- **Write a `## Protocol`, not a flat checklist.** Numbered `### Step N` actions the model works through in order.
- **Add a decision tree wherever a branch matters** — input → which path, with no dead ends.
- **Show at least one BAD/GOOD example** with concrete code, commands, or output — the wrong form next to the corrected one. (A pure ordered diagnostic may substitute exact commands/templates, but stay concrete.)
- **End with a `## Completion checklist`** the invoker can tick off (`- [ ] …`), not vague quality statements.
- **Include a "When NOT to use" section.** Prevents over-application where the skill adds noise.
- **Use RFC 2119 keywords** (MUST, SHOULD, MAY) inside a step only where authority genuinely varies.
- **Aim for ~60–120 lines of actionable content.** Benchmark against `figma-to-code` and `config-echo`. A skill that only restates generic best practice with no protocol, decision tree, or worked example is too thin — it adds nothing over the base model.
- **Keep skills focused on a single workflow.** If a skill covers both security auditing and code review, split it.
- **Make claims traceable.** Where guidance goes beyond convention, cite a primary source (see the packs repo's Research & Sources page).
- After creating or editing skills, run `npx bluetemberg sync`.
