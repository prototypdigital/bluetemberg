import type {
  PresetItem,
  PlatformChoice,
  PackageManagerChoice,
  TeamProfile,
  TeamProfileChoice,
  RuleCollectionPreset,
  GitHubScaffoldConfig,
} from '../types.js';

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
  { id: 'custom', name: 'Custom', description: 'Pick everything individually' },
];

export const RULE_COLLECTION_PRESETS: RuleCollectionPreset[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    packageName: 'bluetemberg-rules-typescript',
    description: 'Type safety, coding standards, early returns, no console.log, design system reuse',
    rules: ['type-safety', 'coding-standards', 'early-returns', 'no-console-log', 'design-system-reuse'],
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'git',
    name: 'Git',
    packageName: 'bluetemberg-rules-git',
    description: 'Git workflow, git move, pre-commit checks',
    rules: ['git-workflow', 'git-move', 'pre-commit-checks'],
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'security',
    name: 'Security',
    packageName: 'bluetemberg-rules-security',
    description: 'Never read .env, secrets management, API error handling',
    rules: ['never-read-env', 'security-secrets', 'api-error-handling'],
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'docs',
    name: 'Docs',
    packageName: 'bluetemberg-rules-docs',
    description: 'Docs parity, post-edit diagnostics, Mermaid diagrams',
    rules: ['docs-parity', 'post-edit-diagnostics', 'mermaid-diagrams'],
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'devops',
    name: 'DevOps',
    packageName: 'bluetemberg-rules-devops',
    description: 'Docker, Ansible, Kubernetes, Terraform, CI/CD workflows, idempotency',
    rules: [
      'docker-best-practices',
      'container-image-pinning',
      'ansible-conventions',
      'kubernetes-manifests',
      'helm-conventions',
      'terraform-conventions',
      'shell-script-standards',
      'ci-workflow-conventions',
      'idempotency',
      'runbook-discipline',
    ],
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    packageName: 'bluetemberg-rules-nextjs',
    description: 'Next.js NEXT_PUBLIC_* env var safety — build-time-only vars, never secrets',
    rules: ['nextjs-public-env-vars'],
    tags: ['frontend', 'fullstack'],
  },
];

export const AGENT_PRESETS: PresetItem[] = [
  {
    id: 'frontend-specialist',
    name: 'Frontend specialist',
    description: 'UI implementation, design-system, i18n, a11y',
    default: true,
    tags: ['frontend', 'fullstack'],
    packageName: 'bluetemberg-agents-frontend-specialist',
  },
  {
    id: 'backend-specialist',
    name: 'Backend specialist',
    description: 'API design, database patterns, error handling, auth',
    default: false,
    tags: ['backend', 'fullstack'],
    packageName: 'bluetemberg-agents-backend-specialist',
  },
  {
    id: 'test-specialist',
    name: 'Test specialist',
    description: 'Test creation, refactoring, stabilization',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
    packageName: 'bluetemberg-agents-test-specialist',
  },
  {
    id: 'docs-maintainer',
    name: 'Docs maintainer',
    description: 'Documentation synchronization with code changes',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-docs-maintainer',
  },
  {
    id: 'code-reviewer',
    name: 'Code reviewer',
    description: 'PR review — patterns, naming, complexity, tests',
    default: false,
    tags: ['frontend', 'backend', 'fullstack'],
    packageName: 'bluetemberg-agents-code-reviewer',
  },
  {
    id: 'a11y-specialist',
    name: 'Accessibility specialist',
    description: 'WCAG 2.2 A/AA audit and remediation',
    default: false,
    tags: ['frontend', 'fullstack'],
    packageName: 'bluetemberg-agents-a11y-specialist',
  },
  {
    id: 'security-specialist',
    name: 'Security specialist',
    description: 'Vulnerability audit, dependency scanning, secrets management',
    default: false,
    tags: ['backend', 'fullstack', 'devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-security-specialist',
  },
  {
    id: 'infrastructure-specialist',
    name: 'Infrastructure specialist',
    description: 'Build, CI, container, deployment config',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-infrastructure-specialist',
  },
  {
    id: 'devops-specialist',
    name: 'DevOps specialist',
    description: 'CI/CD pipelines, container optimization, IaC review',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-devops-specialist',
  },
  {
    id: 'ansible-specialist',
    name: 'Ansible specialist',
    description: 'Ansible roles, playbooks, and Jinja2 templates',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-ansible-specialist',
  },
  {
    id: 'kubernetes-specialist',
    name: 'Kubernetes specialist',
    description: 'Manifests, Helm charts, Kustomize overlays',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-kubernetes-specialist',
  },
  {
    id: 'sre-specialist',
    name: 'SRE specialist',
    description: 'SLOs, alerting, runbooks, post-mortems',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-agents-sre-specialist',
  },
];

export const SKILL_PRESETS: PresetItem[] = [
  {
    id: 'patterns',
    name: 'Patterns',
    description: 'Apply reusable architecture and coding patterns',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
    packageName: 'bluetemberg-skills-patterns',
  },
  {
    id: 'docs-upkeep',
    name: 'Docs upkeep',
    description: 'Keep docs aligned with implementation changes',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-docs-upkeep',
  },
  {
    id: 'workspace-hygiene',
    name: 'Workspace hygiene',
    description: 'Clean workspace state during edits',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-workspace-hygiene',
  },
  {
    id: 'react-patterns',
    name: 'React patterns',
    description: 'Component composition, hook extraction, and state co-location for React projects',
    default: false,
    tags: ['frontend', 'fullstack'],
    packageName: 'bluetemberg-skills-react-patterns',
  },
  {
    id: 'code-review',
    name: 'Code review',
    description: 'Structured review checklist for PRs',
    default: false,
    tags: ['frontend', 'backend', 'fullstack'],
    packageName: 'bluetemberg-skills-code-review',
  },
  {
    id: 'api-design',
    name: 'API design',
    description: 'RESTful conventions, pagination, versioning',
    default: false,
    tags: ['backend', 'fullstack'],
    packageName: 'bluetemberg-skills-api-design',
  },
  {
    id: 'security-audit',
    name: 'Security audit',
    description: 'Dependency audit, secrets scan, OWASP patterns',
    default: false,
    tags: ['backend', 'fullstack', 'devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-security-audit',
  },
  {
    id: 'ci-cd-best-practices',
    name: 'CI/CD best practices',
    description: 'Pipeline optimization, caching strategies',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-ci-cd-best-practices',
  },
  {
    id: 'migration-safety',
    name: 'Migration safety',
    description: 'Database migration review, rollback plans',
    default: false,
    tags: ['backend', 'fullstack'],
    packageName: 'bluetemberg-skills-migration-safety',
  },
  {
    id: 'stack-change-review',
    name: 'Stack change review',
    description: 'High-blast-radius infrastructure change review',
    default: true,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-stack-change-review',
  },
  {
    id: 'infrastructure-drift-check',
    name: 'Infrastructure drift check',
    description: 'Verify declared IaC state matches deployed state before merge',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-infrastructure-drift-check',
  },
  {
    id: 'rollback-plan',
    name: 'Rollback plan',
    description: 'Require tested rollback steps for every production change',
    default: false,
    tags: ['devops', 'pure-infra'],
    packageName: 'bluetemberg-skills-rollback-plan',
  },
];

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
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
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
};
