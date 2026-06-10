import type {
  PresetItem,
  PlatformChoice,
  PackageManagerChoice,
  TeamProfile,
  TeamProfileChoice,
  RuleCollectionPreset,
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
  },
  {
    id: 'backend-specialist',
    name: 'Backend specialist',
    description: 'API design, database patterns, error handling, auth',
    default: false,
    tags: ['backend', 'fullstack'],
  },
  {
    id: 'test-specialist',
    name: 'Test specialist',
    description: 'Test creation, refactoring, stabilization',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'docs-maintainer',
    name: 'Docs maintainer',
    description: 'Documentation synchronization with code changes',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'code-reviewer',
    name: 'Code reviewer',
    description: 'PR review — patterns, naming, complexity, tests',
    default: false,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'a11y-specialist',
    name: 'Accessibility specialist',
    description: 'WCAG 2.2 A/AA audit and remediation',
    default: false,
    tags: ['frontend', 'fullstack'],
  },
  {
    id: 'security-specialist',
    name: 'Security specialist',
    description: 'Vulnerability audit, dependency scanning, secrets management',
    default: false,
    tags: ['backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'infrastructure-specialist',
    name: 'Infrastructure specialist',
    description: 'Build, CI, container, deployment config',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'devops-specialist',
    name: 'DevOps specialist',
    description: 'CI/CD pipelines, container optimization, IaC review',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'ansible-specialist',
    name: 'Ansible specialist',
    description: 'Ansible roles, playbooks, and Jinja2 templates',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'kubernetes-specialist',
    name: 'Kubernetes specialist',
    description: 'Manifests, Helm charts, Kustomize overlays',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'sre-specialist',
    name: 'SRE specialist',
    description: 'SLOs, alerting, runbooks, post-mortems',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
];

export const SKILL_PRESETS: PresetItem[] = [
  {
    id: 'patterns',
    name: 'Patterns',
    description: 'Apply reusable architecture and coding patterns',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'docs-upkeep',
    name: 'Docs upkeep',
    description: 'Keep docs aligned with implementation changes',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'workspace-hygiene',
    name: 'Workspace hygiene',
    description: 'Clean workspace state during edits',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'react-patterns',
    name: 'React patterns',
    description: 'Component composition, hook extraction, and state co-location for React projects',
    default: false,
    tags: ['frontend', 'fullstack'],
  },
  {
    id: 'code-review',
    name: 'Code review',
    description: 'Structured review checklist for PRs',
    default: false,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'api-design',
    name: 'API design',
    description: 'RESTful conventions, pagination, versioning',
    default: false,
    tags: ['backend', 'fullstack'],
  },
  {
    id: 'security-audit',
    name: 'Security audit',
    description: 'Dependency audit, secrets scan, OWASP patterns',
    default: false,
    tags: ['backend', 'fullstack', 'devops', 'pure-infra'],
  },
  {
    id: 'ci-cd-best-practices',
    name: 'CI/CD best practices',
    description: 'Pipeline optimization, caching strategies',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'migration-safety',
    name: 'Migration safety',
    description: 'Database migration review, rollback plans',
    default: false,
    tags: ['backend', 'fullstack'],
  },
  {
    id: 'stack-change-review',
    name: 'Stack change review',
    description: 'High-blast-radius infrastructure change review',
    default: true,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'infrastructure-drift-check',
    name: 'Infrastructure drift check',
    description: 'Verify declared IaC state matches deployed state before merge',
    default: false,
    tags: ['devops', 'pure-infra'],
  },
  {
    id: 'rollback-plan',
    name: 'Rollback plan',
    description: 'Require tested rollback steps for every production change',
    default: false,
    tags: ['devops', 'pure-infra'],
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
  },
];

export const PACKAGE_MANAGERS: PackageManagerChoice[] = [
  { id: 'pnpm', name: 'pnpm' },
  { id: 'npm', name: 'npm' },
  { id: 'yarn', name: 'yarn' },
];
