import type {
  PresetItem,
  PresetOverlay,
  PlatformChoice,
  PackageManagerChoice,
  TeamProfile,
  TeamProfileChoice,
  RuleCollectionOverlay,
  RuleCollectionPreset,
  GitHubScaffoldConfig,
} from '../types.js';
import type { Catalog, CatalogPack } from '../catalog/index.js';

export const TEAM_PROFILES: TeamProfileChoice[] = [
  { id: 'frontend', name: 'Frontend', description: 'UI, design systems, accessibility' },
  { id: 'backend', name: 'Backend', description: 'APIs, databases, auth, services' },
  { id: 'fullstack', name: 'Full-stack', description: 'Frontend + backend combined' },
  { id: 'devops', name: 'DevOps / Platform', description: 'CI/CD, containers, infrastructure-as-code' },
  {
    id: 'pure-infra',
    name: 'Pure Infrastructure',
    description: 'Ansible, Kubernetes, Terraform — no application code',
  },
  {
    id: 'agentic',
    name: 'AI / Agentic Workflow',
    description: 'Context engineering, agent memory, sub-agent design for LLM-heavy projects',
  },
  { id: 'custom', name: 'Custom', description: 'Pick everything individually' },
];

/**
 * Curated rule-collection overlays. Rule ids and profile tags are NOT declared here — they
 * are resolved from the catalog by `packageName` via `resolveRuleCollections`. This list only
 * fixes which collections the wizard offers, their display text, and their order.
 */
export const RULE_COLLECTION_OVERLAYS: RuleCollectionOverlay[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    packageName: 'bluetemberg-rules-typescript',
    description: 'Type safety, coding standards, early returns, no console.log, design system reuse',
  },
  {
    id: 'git',
    name: 'Git',
    packageName: 'bluetemberg-rules-git',
    description: 'Git workflow, git move, pre-commit checks',
  },
  {
    id: 'security',
    name: 'Security',
    packageName: 'bluetemberg-rules-security',
    description: 'Never read .env, secrets management, API error handling, LLM package hallucination',
  },
  {
    id: 'docs',
    name: 'Docs',
    packageName: 'bluetemberg-rules-docs',
    description: 'Docs parity, post-edit diagnostics, Mermaid diagrams',
  },
  {
    id: 'devops',
    name: 'DevOps',
    packageName: 'bluetemberg-rules-devops',
    description: 'Docker, Ansible, Kubernetes, Terraform, CI/CD workflows, idempotency',
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    packageName: 'bluetemberg-rules-nextjs',
    description: 'Next.js env var safety, data fetching, image optimization, metadata, server components',
  },
  {
    id: 'context-engineering',
    name: 'Context engineering',
    packageName: 'bluetemberg-rules-context-engineering',
    description: 'Token budget management, context positioning, prompt structure, multi-turn hygiene',
  },
  {
    id: 'agent-memory',
    name: 'Agent memory',
    packageName: 'bluetemberg-rules-agent-memory',
    description:
      'Statelessness constraints, memory provenance, promotion through consolidation, authority-ranked recall',
  },
  {
    id: 'llm-api-product',
    name: 'LLM API product',
    packageName: 'bluetemberg-rules-llm-api-product',
    description: 'Streaming, cost accounting, cost-aware model selection and routing',
  },
];

/**
 * Curated agent overlays. Profile tags/universal are resolved from the catalog by `packageName`
 * via `resolveAgents`; this list fixes which agents the wizard offers, display text, defaults, and order.
 */
export const AGENT_OVERLAYS: PresetOverlay[] = [
  {
    id: 'frontend-specialist',
    name: 'Frontend specialist',
    description: 'UI implementation, design-system, i18n, a11y',
    default: true,
    packageName: 'bluetemberg-agents-frontend-specialist',
  },
  {
    id: 'backend-specialist',
    name: 'Backend specialist',
    description: 'API design, database patterns, error handling, auth',
    default: false,
    packageName: 'bluetemberg-agents-backend-specialist',
  },
  {
    id: 'test-specialist',
    name: 'Test specialist',
    description: 'Test creation, refactoring, stabilization',
    default: true,
    packageName: 'bluetemberg-agents-test-specialist',
  },
  {
    id: 'docs-maintainer',
    name: 'Docs maintainer',
    description: 'Documentation synchronization with code changes',
    default: true,
    packageName: 'bluetemberg-agents-docs-maintainer',
  },
  {
    id: 'code-reviewer',
    name: 'Code reviewer',
    description: 'PR review — patterns, naming, complexity, tests',
    default: false,
    packageName: 'bluetemberg-agents-code-reviewer',
  },
  {
    id: 'a11y-specialist',
    name: 'Accessibility specialist',
    description: 'WCAG 2.2 A/AA audit and remediation',
    default: false,
    packageName: 'bluetemberg-agents-a11y-specialist',
  },
  {
    id: 'security-specialist',
    name: 'Security specialist',
    description: 'Vulnerability audit, dependency scanning, secrets management',
    default: false,
    packageName: 'bluetemberg-agents-security-specialist',
  },
  {
    id: 'infrastructure-specialist',
    name: 'Infrastructure specialist',
    description: 'Build, CI, container, deployment config',
    default: false,
    packageName: 'bluetemberg-agents-infrastructure-specialist',
  },
  {
    id: 'devops-specialist',
    name: 'DevOps specialist',
    description: 'CI/CD pipelines, container optimization, IaC review',
    default: false,
    packageName: 'bluetemberg-agents-devops-specialist',
  },
  {
    id: 'ansible-specialist',
    name: 'Ansible specialist',
    description: 'Ansible roles, playbooks, and Jinja2 templates',
    default: false,
    packageName: 'bluetemberg-agents-ansible-specialist',
  },
  {
    id: 'kubernetes-specialist',
    name: 'Kubernetes specialist',
    description: 'Manifests, Helm charts, Kustomize overlays',
    default: false,
    packageName: 'bluetemberg-agents-kubernetes-specialist',
  },
  {
    id: 'sre-specialist',
    name: 'SRE specialist',
    description: 'SLOs, alerting, runbooks, post-mortems',
    default: false,
    packageName: 'bluetemberg-agents-sre-specialist',
  },
  {
    id: 'agentic-specialist',
    name: 'Agentic systems specialist',
    description: 'Agent memory design, state management, orchestration patterns, tool-use recovery',
    default: true,
    packageName: 'bluetemberg-agents-agentic-specialist',
  },
];

/**
 * Curated skill overlays. Profile tags/universal are resolved from the catalog by `packageName`
 * via `resolveSkills`; this list fixes which skills the wizard offers, display text, defaults, and order.
 */
export const SKILL_OVERLAYS: PresetOverlay[] = [
  {
    id: 'patterns',
    name: 'Patterns',
    description: 'Apply reusable architecture and coding patterns',
    default: true,
    packageName: 'bluetemberg-skills-patterns',
  },
  {
    id: 'docs-upkeep',
    name: 'Docs upkeep',
    description: 'Keep docs aligned with implementation changes',
    default: true,
    packageName: 'bluetemberg-skills-docs-upkeep',
  },
  {
    id: 'workspace-hygiene',
    name: 'Workspace hygiene',
    description: 'Clean workspace state during edits',
    default: true,
    packageName: 'bluetemberg-skills-workspace-hygiene',
  },
  {
    id: 'react-patterns',
    name: 'React patterns',
    description: 'Component composition, hook extraction, and state co-location for React projects',
    default: false,
    packageName: 'bluetemberg-skills-react-patterns',
  },
  {
    id: 'code-review',
    name: 'Code review',
    description: 'Structured review checklist for PRs',
    default: false,
    packageName: 'bluetemberg-skills-code-review',
  },
  {
    id: 'api-design',
    name: 'API design',
    description: 'RESTful conventions, pagination, versioning',
    default: false,
    packageName: 'bluetemberg-skills-api-design',
  },
  {
    id: 'security-audit',
    name: 'Security audit',
    description: 'Dependency audit, secrets scan, OWASP patterns',
    default: false,
    packageName: 'bluetemberg-skills-security-audit',
  },
  {
    id: 'ci-cd-best-practices',
    name: 'CI/CD best practices',
    description: 'Pipeline optimization, caching strategies',
    default: false,
    packageName: 'bluetemberg-skills-ci-cd-best-practices',
  },
  {
    id: 'migration-safety',
    name: 'Migration safety',
    description: 'Database migration review, rollback plans',
    default: false,
    packageName: 'bluetemberg-skills-migration-safety',
  },
  {
    id: 'stack-change-review',
    name: 'Stack change review',
    description: 'High-blast-radius infrastructure change review',
    default: true,
    packageName: 'bluetemberg-skills-stack-change-review',
  },
  {
    id: 'infrastructure-drift-check',
    name: 'Infrastructure drift check',
    description: 'Verify declared IaC state matches deployed state before merge',
    default: false,
    packageName: 'bluetemberg-skills-infrastructure-drift-check',
  },
  {
    id: 'rollback-plan',
    name: 'Rollback plan',
    description: 'Require tested rollback steps for every production change',
    default: false,
    packageName: 'bluetemberg-skills-rollback-plan',
  },
  {
    id: 'sub-agent-design',
    name: 'Sub-agent design',
    description: 'Plan, scope, and implement sub-agent architectures',
    default: true,
    packageName: 'bluetemberg-skills-sub-agent-design',
  },
];

// ---------------------------------------------------------------------------
// Catalog resolution — join curated overlays with catalog-derived ids/profiles.
// ---------------------------------------------------------------------------

function indexByPackage(catalog: Catalog): Map<string, CatalogPack> {
  return new Map(catalog.packs.map((p) => [p.name, p]));
}

/** Catalog-derived profile fields for a pack (universal packs carry no tags). */
function profileFields(pack: CatalogPack | undefined): { universal?: boolean; tags?: TeamProfile[] } {
  const universal = pack?.universal ?? false;
  return {
    universal: universal || undefined,
    tags: universal ? undefined : (pack?.profiles ?? []),
  };
}

/** Resolve rule-collection overlays against the catalog — rule ids and profile tags come from the matching pack. */
export function resolveRuleCollections(catalog: Catalog): RuleCollectionPreset[] {
  const byPackage = indexByPackage(catalog);
  return RULE_COLLECTION_OVERLAYS.flatMap((overlay) => {
    const pack = byPackage.get(overlay.packageName);
    if (!pack) return [];
    return [{ ...overlay, rules: pack.rules ?? [], ...profileFields(pack) }];
  });
}

function resolvePresetOverlays(overlays: PresetOverlay[], catalog: Catalog): PresetItem[] {
  const byPackage = indexByPackage(catalog);
  return overlays.flatMap((overlay) => {
    const pack = overlay.packageName ? byPackage.get(overlay.packageName) : undefined;
    if (overlay.packageName && !pack) return [];
    return [{ ...overlay, ...profileFields(pack) }];
  });
}

/** Resolve agent overlays against the catalog (profile tags from the matching pack). */
export function resolveAgents(catalog: Catalog): PresetItem[] {
  return resolvePresetOverlays(AGENT_OVERLAYS, catalog);
}

/** Resolve skill overlays against the catalog (profile tags from the matching pack). */
export function resolveSkills(catalog: Catalog): PresetItem[] {
  return resolvePresetOverlays(SKILL_OVERLAYS, catalog);
}

export const MCP_SERVER_PRESETS: PresetItem[] = [
  {
    id: 'interactive',
    name: 'Interactive prompts',
    description: 'User interaction via pop-up prompts (@rawwee/interactive-mcp)',
    default: true,
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Library documentation lookup (@upstash/context7-mcp)',
    default: true,
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Figma design file access',
    default: false,
  },
  {
    id: 'github',
    name: 'GitHub Copilot',
    description: 'GitHub API via Copilot MCP',
    default: false,
  },
];

export const PLATFORM_CHOICES: PlatformChoice[] = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'copilot', name: 'GitHub Copilot' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'codex', name: 'OpenAI Codex' },
  { id: 'claude-marketplace', name: 'Claude Code Marketplace (plugin distribution)' },
];

export interface MarketplacePluginPackChoice {
  id: string;
  displayName: string;
  description: string;
  profiles: TeamProfile[];
}

export const MARKETPLACE_PLUGIN_PACKS: MarketplacePluginPackChoice[] = [
  {
    id: 'frontend',
    displayName: 'Frontend Developer',
    description: 'Skills and agents for React/TypeScript frontend projects',
    profiles: ['frontend'],
  },
  {
    id: 'fullstack',
    displayName: 'Full-Stack Developer',
    description: 'Skills and agents for full-stack projects (frontend + backend)',
    profiles: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'backend',
    displayName: 'Backend Developer',
    description: 'Skills and agents for API, database, and service projects',
    profiles: ['backend'],
  },
  {
    id: 'devops',
    displayName: 'DevOps / Platform Engineer',
    description: 'Skills and agents for CI/CD, containers, and infrastructure',
    profiles: ['devops', 'pure-infra'],
  },
];

export const GUARDRAIL_PRESETS: PresetItem[] = [
  {
    id: 'conventional-branch-names',
    name: 'Conventional branch names',
    description: 'Block auto-generated worktree branch names; require type/description format',
    default: true,
    universal: true,
    packageName: 'bluetemberg-guardrails-git',
  },
];

export const PACKAGE_MANAGERS: PackageManagerChoice[] = [
  { id: 'pnpm', name: 'pnpm' },
  { id: 'npm', name: 'npm' },
  { id: 'yarn', name: 'yarn' },
];

export const GITHUB_FEATURE_PRESETS: PresetItem[] = [
  {
    id: 'ci',
    name: 'CI workflow',
    description: 'Typecheck, lint, test on push and PR',
    default: true,
  },
  {
    id: 'codeql',
    name: 'CodeQL scanning',
    description: 'Static analysis for security vulnerabilities (free for public repos)',
    default: true,
  },
  {
    id: 'dependencyReview',
    name: 'Dependency review',
    description: 'Block PRs that introduce vulnerable or license-incompatible dependencies',
    default: true,
  },
  {
    id: 'dependabot',
    name: 'Dependabot',
    description: 'Auto-update npm and GitHub Actions dependencies weekly',
    default: true,
  },
  {
    id: 'issueTemplates',
    name: 'Issue templates',
    description: 'Structured bug report and feature request forms',
    default: true,
  },
  {
    id: 'prTemplate',
    name: 'PR template',
    description: 'Pull request checklist template',
    default: true,
  },
  {
    id: 'codeowners',
    name: 'CODEOWNERS',
    description: 'Assign default PR reviewers by file path',
    default: true,
  },
  {
    id: 'releaseWorkflow',
    name: 'Release workflow',
    description: 'Auto-create GitHub Release with notes on version tags',
    default: true,
  },
  {
    id: 'staleBot',
    name: 'Stale bot',
    description: 'Close stale issues and PRs after 60 days of inactivity',
    default: false,
  },
  {
    id: 'pagesWorkflow',
    name: 'GitHub Pages',
    description: 'Deploy a docs site to GitHub Pages on push to main',
    default: false,
  },
  {
    id: 'contributing',
    name: 'CONTRIBUTING.md',
    description: 'Contribution guidelines for new contributors',
    default: true,
  },
  {
    id: 'license',
    name: 'LICENSE',
    description: 'MIT license file in repo root',
    default: true,
  },
  {
    id: 'codeOfConduct',
    name: 'CODE_OF_CONDUCT.md',
    description: 'Contributor Covenant 2.1 code of conduct',
    default: true,
  },
  {
    id: 'security',
    name: 'SECURITY.md',
    description: 'Vulnerability reporting instructions',
    default: true,
  },
  {
    id: 'semanticPr',
    name: 'Semantic PR check',
    description: 'Enforce Conventional Commits PR title format (feat/fix/chore/…)',
    default: true,
  },
  {
    id: 'autoLabeler',
    name: 'Auto-labeler',
    description: 'Label PRs automatically by changed file paths',
    default: false,
  },
  {
    id: 'lockClosed',
    name: 'Lock closed threads',
    description: 'Lock closed issues and PRs after inactivity to reduce noise',
    default: false,
  },
];

export const DEFAULT_GITHUB_CONFIG: GitHubScaffoldConfig = {
  ci: true,
  codeql: true,
  dependencyReview: true,
  dependabot: true,
  issueTemplates: true,
  prTemplate: true,
  codeowners: true,
  releaseWorkflow: true,
  staleBot: false,
  pagesWorkflow: false,
  contributing: true,
  license: true,
  codeOfConduct: true,
  security: true,
  semanticPr: true,
  autoLabeler: false,
  lockClosed: false,
};
