# Profiles

The first question the `init` wizard asks is **Team profile**. Your answer sets smart defaults for which rules, agents, and skills are pre-checked — you can still add or remove anything before confirming.

## How profiles work

The wizard offers every rules, agents and skills pack in the catalog. Each pack's catalog entry lists the profiles it is a default for (`profiles`), or marks it `universal`. When you pick a profile, every pack tagged for that profile, plus every universal pack, is pre-checked. Packs not tagged for your profile are still offered, just unchecked. Packs that are neither tagged nor universal, such as `rules-commit-attribution`, are opt-in for every profile.

Profile routing is owned by the packs repo, so the tables below follow the catalog snapshot that ships with this engine version.

## Default collections by profile

| Collection | Frontend | Backend | Full-stack | DevOps | Pure Infra | Agentic | Design Engineer | Custom |
| ---------- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :----: |
| TypeScript | ✓ | ✓ | ✓ | — | — | — | — | — |
| Git | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Security | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Docs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| DevOps | — | — | — | ✓ | ✓ | — | — | — |
| Next.js | ✓¹ | — | ✓¹ | — | — | — | — | — |
| Design craft | — | — | — | — | — | — | ✓ | — |
| Context engineering | — | — | — | — | — | ✓ | — | — |
| Agent memory | — | — | — | — | — | ✓ | — | — |
| LLM API product | — | ✓ | ✓ | — | — | ✓ | — | — |
| Accessibility rules | ✓ | — | ✓ | — | — | — | — | — |
| Commit and PR attribution hygiene rules | — | — | — | — | — | — | — | — |
| Internationalization rules | ✓¹ | — | ✓¹ | — | — | — | — | — |
| Payload CMS rules | — | ✓¹ | ✓¹ | — | — | — | — | — |
| GitHub PR and issue link formatting rules | — | — | — | — | — | — | — | — |
| Rules for contributing to @prototyp/skeletor | ✓¹ | — | ✓¹ | — | — | — | — | — |
| Rules for consuming @prototyp/skeletor in React Native apps | ✓¹ | — | ✓¹ | — | — | — | — | — |
| Tailwind CSS v4 rules | ✓¹ | — | ✓¹ | — | — | — | — | — |
| Testing rules | ✓ | ✓ | ✓ | — | — | — | — | — |

¹ Only when the pack's stack is in the project (see **Stacks** below).

Collections marked universal in the catalog (Git, Security, Docs) are preselected for every profile except Custom, as are universal agents, skills and guardrails such as `docs-maintainer`, the create-rule/agent/skill/pack skills, and `bluetemberg-guardrails-git`.

### Stacks

A pack that targets stacks in the catalog (Payload, Skeletor, React Native, Tailwind, Next.js, React) is preselected only when one of those stacks is in the project: detected by `init` from your manifests and lockfile, kept in the wizard's stack prompt, or passed with `--stacks`. In an empty directory no stack-specific pack is preselected. These packs are always offered in the wizard, so you can still tick them by hand. `bluetemberg preview <profile>` runs the same detection in the current directory and lists the packs it would skip.

## Frontend

> UI, design systems, accessibility

Profile id: `frontend`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| TypeScript | `bluetemberg-rules-typescript` | — | Type safety, coding standards, early returns, no console.log, design system reuse |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| Next.js | `bluetemberg-rules-nextjs` | nextjs | Next.js env var safety, data fetching, image optimization, metadata, server components |
| Accessibility rules | `bluetemberg-rules-accessibility` | — | WCAG 2.2 A/AA guidance for semantic HTML, ARIA, keyboard navigation, and more. |
| Internationalization rules | `bluetemberg-rules-i18n` | nextjs, payload | next-intl locale routing, Payload localized-field discipline, locale route guards, and message-key conventions. |
| Rules for contributing to @prototyp/skeletor | `bluetemberg-rules-skeletor-authoring` | skeletor | style-prop pipeline, polymorphic spacing, component structure, RN Animated, context defaults, and type derivation. |
| Rules for consuming @prototyp/skeletor in React Native apps | `bluetemberg-rules-skeletor-consumer` | react-native | Block/Text/Screen primitives, SkeletorProvider config, animation hooks, and skeleform forms over raw RN primitives. |
| Tailwind CSS v4 rules | `bluetemberg-rules-tailwind` | tailwind | @theme token discipline, fluid typography, OKLch colors, and single-source breakpoints. |
| Testing rules | `bluetemberg-rules-testing` | — | determinism, isolation, and meaningful coverage. |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Frontend specialist | `bluetemberg-agents-frontend-specialist` | — | UI implementation, design-system, i18n, a11y |
| Test specialist | `bluetemberg-agents-test-specialist` | — | Test creation, refactoring, stabilization |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Code reviewer | `bluetemberg-agents-code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| Accessibility specialist | `bluetemberg-agents-a11y-specialist` | — | WCAG 2.2 A/AA audit and remediation |
| Headless PR reviewer agent | `bluetemberg-agents-pr-reviewer` | — | fetches PR context with gh, posts a comment-only review with Conventional Comments findings. |
| Skeletor specialist agent | `bluetemberg-agents-skeletor-specialist` | skeletor, react-native | covers both consuming the public API (Block/Screen/Text, SkeletorProvider, animation hooks, skeleform) and authoring library internals (style-prop pipeline, memoizeStyle, Biome, release-please). |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Patterns | `bluetemberg-skills-patterns` | — | Apply reusable architecture and coding patterns |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| React patterns | `bluetemberg-skills-react-patterns` | react | Component composition, hook extraction, and state co-location for React projects |
| Code review | `bluetemberg-skills-code-review` | — | Structured review checklist for PRs |
| Config echo skill | `bluetemberg-skills-config-echo` | — | verifies that synced configuration was actually loaded by the LLM. |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |
| Design-system reuse skill | `bluetemberg-skills-design-system` | react | reach for shadcn/Radix primitives, cn()/cva() composition, and asChild polymorphism before bespoke UI. |
| Next.js caching & ISR skill | `bluetemberg-skills-nextjs-caching` | nextjs | unstable_cache keyParts vs tags discipline, revalidateTag call sites, and the ISR cache handler. |
| Payload CMS block-system skill | `bluetemberg-skills-payload-blocks` | payload | the co-located config.ts + Component.tsx pattern and the registry-dispatch RenderBlocks convention. |
| PR review loop skill | `bluetemberg-skills-pr-review-loop` | — | wire automated comment-only PR reviews via a local PostToolUse hook, without touching CI/CD. |
| Skills for scaffolding @prototyp/skeletor primitives and hooks | `bluetemberg-skills-skeletor-authoring` | skeletor | folder + barrel + extract/memoize/displayName, and ref-stable RN Animated hooks. |

## Backend

> APIs, databases, auth, services

Profile id: `backend`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| TypeScript | `bluetemberg-rules-typescript` | — | Type safety, coding standards, early returns, no console.log, design system reuse |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| LLM API product | `bluetemberg-rules-llm-api-product` | — | Streaming, cost accounting, cost-aware model selection and routing |
| Payload CMS rules | `bluetemberg-rules-payload` | payload | collection structure, snake_case dbName, composable access, field builders, revalidation hooks. |
| Testing rules | `bluetemberg-rules-testing` | — | determinism, isolation, and meaningful coverage. |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Backend specialist | `bluetemberg-agents-backend-specialist` | — | API design, database patterns, error handling, auth |
| Test specialist | `bluetemberg-agents-test-specialist` | — | Test creation, refactoring, stabilization |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Code reviewer | `bluetemberg-agents-code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| Security specialist | `bluetemberg-agents-security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| Payload CMS specialist agent | `bluetemberg-agents-payload-specialist` | payload | collections, globals, blocks, fields, hooks, access, Lexical, plugins, and the generated types contract. |
| Headless PR reviewer agent | `bluetemberg-agents-pr-reviewer` | — | fetches PR context with gh, posts a comment-only review with Conventional Comments findings. |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Patterns | `bluetemberg-skills-patterns` | — | Apply reusable architecture and coding patterns |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| Code review | `bluetemberg-skills-code-review` | — | Structured review checklist for PRs |
| API design | `bluetemberg-skills-api-design` | — | RESTful conventions, pagination, versioning |
| Security audit | `bluetemberg-skills-security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| Migration safety | `bluetemberg-skills-migration-safety` | — | Database migration review, rollback plans |
| Config echo skill | `bluetemberg-skills-config-echo` | — | verifies that synced configuration was actually loaded by the LLM. |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |
| Third-party integration-safety skill | `bluetemberg-skills-integration-safety` | — | lazy init, getRequiredEnv, safeParse over parse, fire-and-forget analytics, and safe widget script injection. |
| k6 load-testing skill | `bluetemberg-skills-k6-load-testing` | — | scenario taxonomy, shared config/requests libs, p95 threshold discipline, and __ENV-parametrized suites wired into CI. |
| Orval OpenAPI client-generation skill | `bluetemberg-skills-orval-openapi` | — | the build:api pipeline, tags-split output, the custom fetch mutator, and never hand-editing generated files. |
| Payload + Next.js cache revalidation skill | `bluetemberg-skills-payload-cache-revalidation` | payload | a single source of truth for cache tags and the per-locale vs locale-agnostic decision. |
| Payload CMS migration workflow skill | `bluetemberg-skills-payload-migrations` | payload | generate-don't-handwrite, paired .ts/.json snapshots, and gated destructive changes. |
| PR review loop skill | `bluetemberg-skills-pr-review-loop` | — | wire automated comment-only PR reviews via a local PostToolUse hook, without touching CI/CD. |

## Full-stack

> Frontend + backend combined

Profile id: `fullstack`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| TypeScript | `bluetemberg-rules-typescript` | — | Type safety, coding standards, early returns, no console.log, design system reuse |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| Next.js | `bluetemberg-rules-nextjs` | nextjs | Next.js env var safety, data fetching, image optimization, metadata, server components |
| LLM API product | `bluetemberg-rules-llm-api-product` | — | Streaming, cost accounting, cost-aware model selection and routing |
| Accessibility rules | `bluetemberg-rules-accessibility` | — | WCAG 2.2 A/AA guidance for semantic HTML, ARIA, keyboard navigation, and more. |
| Internationalization rules | `bluetemberg-rules-i18n` | nextjs, payload | next-intl locale routing, Payload localized-field discipline, locale route guards, and message-key conventions. |
| Payload CMS rules | `bluetemberg-rules-payload` | payload | collection structure, snake_case dbName, composable access, field builders, revalidation hooks. |
| Rules for contributing to @prototyp/skeletor | `bluetemberg-rules-skeletor-authoring` | skeletor | style-prop pipeline, polymorphic spacing, component structure, RN Animated, context defaults, and type derivation. |
| Rules for consuming @prototyp/skeletor in React Native apps | `bluetemberg-rules-skeletor-consumer` | react-native | Block/Text/Screen primitives, SkeletorProvider config, animation hooks, and skeleform forms over raw RN primitives. |
| Tailwind CSS v4 rules | `bluetemberg-rules-tailwind` | tailwind | @theme token discipline, fluid typography, OKLch colors, and single-source breakpoints. |
| Testing rules | `bluetemberg-rules-testing` | — | determinism, isolation, and meaningful coverage. |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Frontend specialist | `bluetemberg-agents-frontend-specialist` | — | UI implementation, design-system, i18n, a11y |
| Backend specialist | `bluetemberg-agents-backend-specialist` | — | API design, database patterns, error handling, auth |
| Test specialist | `bluetemberg-agents-test-specialist` | — | Test creation, refactoring, stabilization |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Code reviewer | `bluetemberg-agents-code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| Accessibility specialist | `bluetemberg-agents-a11y-specialist` | — | WCAG 2.2 A/AA audit and remediation |
| Security specialist | `bluetemberg-agents-security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| Payload CMS specialist agent | `bluetemberg-agents-payload-specialist` | payload | collections, globals, blocks, fields, hooks, access, Lexical, plugins, and the generated types contract. |
| Headless PR reviewer agent | `bluetemberg-agents-pr-reviewer` | — | fetches PR context with gh, posts a comment-only review with Conventional Comments findings. |
| Skeletor specialist agent | `bluetemberg-agents-skeletor-specialist` | skeletor, react-native | covers both consuming the public API (Block/Screen/Text, SkeletorProvider, animation hooks, skeleform) and authoring library internals (style-prop pipeline, memoizeStyle, Biome, release-please). |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Patterns | `bluetemberg-skills-patterns` | — | Apply reusable architecture and coding patterns |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| React patterns | `bluetemberg-skills-react-patterns` | react | Component composition, hook extraction, and state co-location for React projects |
| Code review | `bluetemberg-skills-code-review` | — | Structured review checklist for PRs |
| API design | `bluetemberg-skills-api-design` | — | RESTful conventions, pagination, versioning |
| Security audit | `bluetemberg-skills-security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| Migration safety | `bluetemberg-skills-migration-safety` | — | Database migration review, rollback plans |
| Config echo skill | `bluetemberg-skills-config-echo` | — | verifies that synced configuration was actually loaded by the LLM. |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |
| Design-system reuse skill | `bluetemberg-skills-design-system` | react | reach for shadcn/Radix primitives, cn()/cva() composition, and asChild polymorphism before bespoke UI. |
| Third-party integration-safety skill | `bluetemberg-skills-integration-safety` | — | lazy init, getRequiredEnv, safeParse over parse, fire-and-forget analytics, and safe widget script injection. |
| k6 load-testing skill | `bluetemberg-skills-k6-load-testing` | — | scenario taxonomy, shared config/requests libs, p95 threshold discipline, and __ENV-parametrized suites wired into CI. |
| Next.js caching & ISR skill | `bluetemberg-skills-nextjs-caching` | nextjs | unstable_cache keyParts vs tags discipline, revalidateTag call sites, and the ISR cache handler. |
| Orval OpenAPI client-generation skill | `bluetemberg-skills-orval-openapi` | — | the build:api pipeline, tags-split output, the custom fetch mutator, and never hand-editing generated files. |
| Payload CMS block-system skill | `bluetemberg-skills-payload-blocks` | payload | the co-located config.ts + Component.tsx pattern and the registry-dispatch RenderBlocks convention. |
| Payload + Next.js cache revalidation skill | `bluetemberg-skills-payload-cache-revalidation` | payload | a single source of truth for cache tags and the per-locale vs locale-agnostic decision. |
| Payload CMS migration workflow skill | `bluetemberg-skills-payload-migrations` | payload | generate-don't-handwrite, paired .ts/.json snapshots, and gated destructive changes. |
| PR review loop skill | `bluetemberg-skills-pr-review-loop` | — | wire automated comment-only PR reviews via a local PostToolUse hook, without touching CI/CD. |
| Skills for scaffolding @prototyp/skeletor primitives and hooks | `bluetemberg-skills-skeletor-authoring` | skeletor | folder + barrel + extract/memoize/displayName, and ref-stable RN Animated hooks. |

## DevOps / Platform

> CI/CD, containers, infrastructure-as-code

Profile id: `devops`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| DevOps | `bluetemberg-rules-devops` | — | Docker, Ansible, Kubernetes, Terraform, CI/CD workflows, idempotency |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Security specialist | `bluetemberg-agents-security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| Infrastructure specialist | `bluetemberg-agents-infrastructure-specialist` | — | Build, CI, container, deployment config |
| DevOps specialist | `bluetemberg-agents-devops-specialist` | — | CI/CD pipelines, container optimization, IaC review |
| Ansible specialist | `bluetemberg-agents-ansible-specialist` | — | Ansible roles, playbooks, and Jinja2 templates |
| Kubernetes specialist | `bluetemberg-agents-kubernetes-specialist` | — | Manifests, Helm charts, Kustomize overlays |
| SRE specialist | `bluetemberg-agents-sre-specialist` | — | SLOs, alerting, runbooks, post-mortems |
| Headless PR reviewer agent | `bluetemberg-agents-pr-reviewer` | — | fetches PR context with gh, posts a comment-only review with Conventional Comments findings. |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| Security audit | `bluetemberg-skills-security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| CI/CD best practices | `bluetemberg-skills-ci-cd-best-practices` | — | Pipeline optimization, caching strategies |
| Stack change review | `bluetemberg-skills-stack-change-review` | — | High-blast-radius infrastructure change review |
| Infrastructure drift check | `bluetemberg-skills-infrastructure-drift-check` | — | Verify declared IaC state matches deployed state before merge |
| Rollback plan | `bluetemberg-skills-rollback-plan` | — | Require tested rollback steps for every production change |
| Config echo skill | `bluetemberg-skills-config-echo` | — | verifies that synced configuration was actually loaded by the LLM. |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |
| k6 load-testing skill | `bluetemberg-skills-k6-load-testing` | — | scenario taxonomy, shared config/requests libs, p95 threshold discipline, and __ENV-parametrized suites wired into CI. |
| PR review loop skill | `bluetemberg-skills-pr-review-loop` | — | wire automated comment-only PR reviews via a local PostToolUse hook, without touching CI/CD. |

## Pure Infrastructure

> Ansible, Kubernetes, Terraform — no application code

Profile id: `pure-infra`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| DevOps | `bluetemberg-rules-devops` | — | Docker, Ansible, Kubernetes, Terraform, CI/CD workflows, idempotency |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Security specialist | `bluetemberg-agents-security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| Infrastructure specialist | `bluetemberg-agents-infrastructure-specialist` | — | Build, CI, container, deployment config |
| DevOps specialist | `bluetemberg-agents-devops-specialist` | — | CI/CD pipelines, container optimization, IaC review |
| Ansible specialist | `bluetemberg-agents-ansible-specialist` | — | Ansible roles, playbooks, and Jinja2 templates |
| Kubernetes specialist | `bluetemberg-agents-kubernetes-specialist` | — | Manifests, Helm charts, Kustomize overlays |
| SRE specialist | `bluetemberg-agents-sre-specialist` | — | SLOs, alerting, runbooks, post-mortems |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| Security audit | `bluetemberg-skills-security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| CI/CD best practices | `bluetemberg-skills-ci-cd-best-practices` | — | Pipeline optimization, caching strategies |
| Stack change review | `bluetemberg-skills-stack-change-review` | — | High-blast-radius infrastructure change review |
| Infrastructure drift check | `bluetemberg-skills-infrastructure-drift-check` | — | Verify declared IaC state matches deployed state before merge |
| Rollback plan | `bluetemberg-skills-rollback-plan` | — | Require tested rollback steps for every production change |
| Config echo skill | `bluetemberg-skills-config-echo` | — | verifies that synced configuration was actually loaded by the LLM. |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |

## AI / Agentic Workflow

> Context engineering, agent memory, sub-agent design for LLM-heavy projects

Profile id: `agentic`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| Context engineering | `bluetemberg-rules-context-engineering` | — | Token budget management, context positioning, prompt structure, multi-turn hygiene |
| Agent memory | `bluetemberg-rules-agent-memory` | — | Statelessness constraints, memory provenance, promotion through consolidation, authority-ranked recall |
| LLM API product | `bluetemberg-rules-llm-api-product` | — | Streaming, cost accounting, cost-aware model selection and routing |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Agentic systems specialist | `bluetemberg-agents-agentic-specialist` | — | Agent memory design, state management, orchestration patterns, tool-use recovery |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| Sub-agent design | `bluetemberg-skills-sub-agent-design` | — | Plan, scope, and implement sub-agent architectures |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |

## Design Engineer

> Anti-stock UI craft, design-to-code, visual direction & critique

Profile id: `design-engineer`.

### Rule collections

| Collection | Package | Stacks | Description |
| --- | --- | --- | --- |
| Git | `bluetemberg-rules-git` | — | Git workflow, git move, pre-commit checks |
| Security | `bluetemberg-rules-security` | — | Never read .env, secrets management, API error handling, LLM package hallucination |
| Docs | `bluetemberg-rules-docs` | — | Docs parity, post-edit diagnostics, Mermaid diagrams |
| Design craft | `bluetemberg-rules-design-craft` | — | Anti-stock defaults, banned moves, references over moods, tokens before components, every state |

### Agents

| Agent | Package | Stacks | Description |
| --- | --- | --- | --- |
| Frontend specialist | `bluetemberg-agents-frontend-specialist` | — | UI implementation, design-system, i18n, a11y |
| Docs maintainer | `bluetemberg-agents-docs-maintainer` | — | Documentation synchronization with code changes |
| Accessibility specialist | `bluetemberg-agents-a11y-specialist` | — | WCAG 2.2 A/AA audit and remediation |
| Design engineer | `bluetemberg-agents-design-engineer` | — | Anti-stock UI build to a reference; holds tokens and banned moves; catches drift |

### Skills

| Skill | Package | Stacks | Description |
| --- | --- | --- | --- |
| Docs upkeep | `bluetemberg-skills-docs-upkeep` | — | Keep docs aligned with implementation changes |
| Workspace hygiene | `bluetemberg-skills-workspace-hygiene` | — | Clean workspace state during edits |
| React patterns | `bluetemberg-skills-react-patterns` | react | Component composition, hook extraction, and state co-location for React projects |
| Figma to code | `bluetemberg-skills-figma-to-code` | — | Section-by-section design-to-code loop with prompt stacking and drift checks |
| Design critique | `bluetemberg-skills-design-critique` | — | Multi-lens critique, hostile QA, and an impact-ranked fix list |
| Visual direction | `bluetemberg-skills-visual-direction` | — | Explore and lock a visual direction; produce banned moves and a Design System Document |
| Meta-skill for scaffolding new bluetemberg agents | `bluetemberg-skills-create-agent` | — | frontmatter, scoped tools, responsibilities and constraints, and sync. |
| Meta-skill for scaffolding a whole new bluetemberg pack | `bluetemberg-skills-create-pack` | — | package.json metadata, llm/ layout, catalog registration, and validation. |
| Meta-skill for scaffolding new bluetemberg rules | `bluetemberg-skills-create-rule` | — | frontmatter, the Why/Rules/BAD-GOOD/config/gotchas structure, and sync. |
| Meta-skill for scaffolding new bluetemberg skills | `bluetemberg-skills-create-skill` | — | frontmatter, five required sections, and sync. |
| Design-system reuse skill | `bluetemberg-skills-design-system` | react | reach for shadcn/Radix primitives, cn()/cva() composition, and asChild polymorphism before bespoke UI. |

## Custom

Pick everything individually. No collections are pre-checked. Use this when your project doesn't fit a standard profile or when you want full control.

## Switching profiles

After init, switch the active profile at any time:

```bash
bluetemberg switch-profile backend
```

This adds any agent and skill packages belonging to the new profile's defaults that are not yet in `llm/packages.json`. Stack-specific packs follow the same rule as `init`: they're added only when their stack is detected in the project or declared in `bluetemberg.config.json` `stacks`. It never removes packages automatically — instead it reports which official agent/skill packages in the manifest are not part of the new profile's defaults so you can decide whether to keep or remove them manually.

Stale detection is scoped to the agents and skills packs in the catalog. Rule collections (e.g. `bluetemberg-rules-typescript`) and any third-party packs are never flagged — the switch cannot know which kind they are and should not touch them.

After switching, run `bluetemberg sync` to regenerate platform files.
