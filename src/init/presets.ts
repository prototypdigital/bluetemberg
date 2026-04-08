import type { PresetItem, PlatformChoice, PackageManagerChoice, TeamProfileChoice } from '../types.js';

export const TEAM_PROFILES: TeamProfileChoice[] = [
  { id: 'frontend', name: 'Frontend', description: 'UI, design systems, accessibility' },
  { id: 'backend', name: 'Backend', description: 'APIs, databases, auth, services' },
  { id: 'fullstack', name: 'Full-stack', description: 'Frontend + backend combined' },
  { id: 'devops', name: 'DevOps / Platform', description: 'CI/CD, containers, infrastructure-as-code' },
  { id: 'custom', name: 'Custom', description: 'Pick everything individually' },
];

export const RULE_PRESETS: PresetItem[] = [
  {
    id: 'coding-standards',
    name: 'Coding standards',
    description: 'Function complexity, readability, naming conventions',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
  },
  {
    id: 'early-returns',
    name: 'Early returns',
    description: 'Guard clauses over nested conditionals',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
  },
  {
    id: 'type-safety',
    name: 'Type safety',
    description: 'No any, no unguarded assertions, prefer unknown',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'no-console-log',
    name: 'No console.log',
    description: 'Forbid console.* in production code, use logger',
    default: false,
    tags: ['backend', 'fullstack'],
  },
  {
    id: 'git-move',
    name: 'Git move',
    description: 'Use git mv for tracked files to preserve history',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
  },
  {
    id: 'never-read-env',
    name: 'Never read .env',
    description: 'Never read .env files directly in code',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
  },
  {
    id: 'post-edit-diagnostics',
    name: 'Post-edit diagnostics',
    description: 'Run diagnostics after editing code files',
    default: true,
    tags: ['frontend', 'backend', 'fullstack'],
  },
  {
    id: 'design-system-reuse',
    name: 'Design system reuse',
    description: 'Reuse shared UI components and tokens before creating new ones',
    default: false,
    tags: ['frontend', 'fullstack'],
  },
  {
    id: 'api-error-handling',
    name: 'API error handling',
    description: 'Structured error responses, never leak stack traces',
    default: false,
    tags: ['backend', 'fullstack'],
  },
  {
    id: 'security-secrets',
    name: 'Security — secrets',
    description: 'Never hardcode secrets, tokens, or credentials',
    default: false,
    tags: ['backend', 'fullstack', 'devops'],
  },
  {
    id: 'docker-best-practices',
    name: 'Docker best practices',
    description: 'Multi-stage builds, non-root users, layer caching',
    default: false,
    tags: ['devops'],
  },
  {
    id: 'terraform-conventions',
    name: 'Terraform conventions',
    description: 'Module structure, naming, state management',
    default: false,
    tags: ['devops'],
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
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
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
    tags: ['backend', 'fullstack', 'devops'],
  },
  {
    id: 'infrastructure-specialist',
    name: 'Infrastructure specialist',
    description: 'Build, CI, container, deployment config',
    default: false,
    tags: ['devops'],
  },
  {
    id: 'devops-specialist',
    name: 'DevOps specialist',
    description: 'CI/CD pipelines, container optimization, IaC review',
    default: false,
    tags: ['devops'],
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
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
  },
  {
    id: 'workspace-hygiene',
    name: 'Workspace hygiene',
    description: 'Clean workspace state during edits',
    default: true,
    tags: ['frontend', 'backend', 'fullstack', 'devops'],
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
    tags: ['backend', 'fullstack', 'devops'],
  },
  {
    id: 'ci-cd-best-practices',
    name: 'CI/CD best practices',
    description: 'Pipeline optimization, caching strategies',
    default: false,
    tags: ['devops'],
  },
  {
    id: 'migration-safety',
    name: 'Migration safety',
    description: 'Database migration review, rollback plans',
    default: false,
    tags: ['backend', 'fullstack'],
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
];

export const PACKAGE_MANAGERS: PackageManagerChoice[] = [
  { id: 'pnpm', name: 'pnpm' },
  { id: 'npm', name: 'npm' },
  { id: 'yarn', name: 'yarn' },
];
