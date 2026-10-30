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

## Migrating commands and prompts

Every host has folded slash commands and prompt files into skills:

- Claude Code merged custom commands into skills; a skill and a command with the same name both create `/name`, and the skill wins ([Claude Code: Skills](https://code.claude.com/docs/en/skills)).
- VS Code runs prompt files only in the Local harness and recommends migrating them to skills, with a built-in "Convert Prompt to Skills" migration ([VS Code 1.129](https://code.visualstudio.com/updates/v1_129), [Migrate customizations](https://code.visualstudio.com/docs/agent-customization/migrate-customizations)).
- Devin Desktop replaced workflows with skills ([Devin: Workflows](https://docs.devin.ai/desktop/cascade/workflows)).

So sync now also writes each `llm/commands/*.md` and `llm/prompts/*.md` file as a **generated skill**, to every skills target of the enabled platforms (`.claude/skills/`, `.github/skills/`, `.cursor/skills/`, `.agents/skills/`). Before, a command reached Claude Code only and a prompt reached Copilot only.

| Source                          | Generated skill                  |
| ------------------------------- | -------------------------------- |
| `llm/commands/ship.md`          | `<skills dir>/ship/SKILL.md`     |
| `llm/prompts/review.md`         | `<skills dir>/review/SKILL.md`   |
| `llm/prompts/fix.prompt.md`     | `<skills dir>/fix/SKILL.md`      |

The body is copied as written. The frontmatter changes like this:

- **`name`**: the file name without `.md` (and without `.prompt`). A prompt file's own `name` field takes precedence, because that is what VS Code put after the `/`.
- **`description`**: the source `description`. Without one, the first heading or line of the body is used, since every host requires a description.
- **`disable-model-invocation: true`**: keeps the skill user-invoked, the way the command or prompt was. VS Code's and Cursor's own migrations make the same choice. An explicit value in the source is kept. Codex and Devin ignore that field, so in the skills dir they read (`.agents/skills/`) a user-only skill also gets their own switch: `triggers: [user]` in the frontmatter when **devin** is enabled ([Devin CLI skills](https://docs.devin.ai/cli/extensibility/skills/overview)), and an `agents/openai.yaml` with `policy.allow_implicit_invocation: false` when **codex** is enabled ([Codex skills](https://learn.chatgpt.com/docs/build-skills)). Antigravity has no such switch, so it may still load a migrated command on its own initiative ([Antigravity skills](https://antigravity.google/docs/skills)); keep a command with side effects out of `llm/commands/` if Antigravity is enabled, or guard it with a [guardrail](Guardrails).
- **Other fields** of a command (`argument-hint`, `allowed-tools`, `model`, …) are Claude Code skill fields too, and are carried over. A prompt's `agent`, `mode`, `model` and `tools` have no skill equivalent. They are left out with a warning, as VS Code's migration does. For a fixed agent, model or tool set, write a [custom agent](Writing-Agents) instead.

`$ARGUMENTS` and `$1`-style placeholders are substituted by Claude Code only. Other hosts pass the text after the command to the model as context.

Invocation keeps working where the host supports `/name` for skills: Claude Code, Copilot in VS Code, Cursor, and Antigravity. Codex mentions skills as `$name`. Devin Cloud uses `@skills:name`. Gemini CLI gets no skills from sync.

### Name collisions

- **A real skill wins.** If `llm/skills/<name>/` exists (locally, in `extends` or in a pack), no skill is generated for the command or prompt of that name, and sync warns.
- **A hand-written skill in an output dir is never overwritten.** A `SKILL.md` without the generated-file banner is kept, and so is a dir that holds files but no `SKILL.md` (a bannered `SKILL.md` there would let `--prune` delete those files). Sync warns.
- **Frontmatter that is not valid YAML** gets no skill, with a warning; the legacy output is still written, as before.
- **A command beats a prompt** of the same name, with a warning.
- **A name that is not a valid skill name** (lowercase letters, digits and single hyphens, at most 64 characters, per the [Agent Skills spec](https://agentskills.io/specification)) gets no skill. Copilot silently ignores a skill with an invalid name, so sync warns instead of writing one.

Generated skills carry the banner, so `sync --check`, `sync --prune` and `bluetemberg uninstall` treat them like any other generated output.

### Transition and removal plan

| Release   | `.claude/commands/` and `.github/prompts/`                                                                 | Generated skills |
| --------- | ---------------------------------------------------------------------------------------------------------- | ---------------- |
| 0.17      | Still written. Each sync warns once that they are deprecated.                                              | Written          |
| 0.18.0    | No longer written. `bluetemberg sync --prune` removes the old generated files.                             | Written          |

To migrate a command or prompt for good, move it into `llm/skills/` and give it skill frontmatter:

```bash
mkdir -p llm/skills/ship
git mv llm/commands/ship.md llm/skills/ship/SKILL.md
# add name, description and disable-model-invocation: true to the frontmatter
bluetemberg sync --prune
```

The skill is then a real skill: it can ship supporting files, packs can carry it, and the deprecation warning goes away once `llm/commands/` and `llm/prompts/` are empty.

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
