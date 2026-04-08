import type {
  PresetItem,
  PlatformChoice,
  PackageManagerChoice,
} from "../types.js";

export const RULE_PRESETS: PresetItem[] = [
  {
    id: "coding-standards",
    name: "Coding standards",
    description: "Function complexity, readability, naming conventions",
    default: true,
  },
  {
    id: "no-console-log",
    name: "No console.log",
    description: "Forbid console.* in production code, use logger",
    default: false,
  },
  {
    id: "git-move",
    name: "Git move",
    description: "Use git mv for tracked files to preserve history",
    default: true,
  },
  {
    id: "never-read-env",
    name: "Never read .env",
    description: "Never read .env files directly in code",
    default: true,
  },
  {
    id: "post-edit-diagnostics",
    name: "Post-edit diagnostics",
    description: "Run diagnostics after editing code files",
    default: true,
  },
  {
    id: "design-system-reuse",
    name: "Design system reuse",
    description:
      "Reuse shared UI components and tokens before creating new ones",
    default: false,
  },
];

export const AGENT_PRESETS: PresetItem[] = [
  {
    id: "frontend-specialist",
    name: "Frontend specialist",
    description: "UI implementation, design-system, i18n, a11y",
    default: true,
  },
  {
    id: "test-specialist",
    name: "Test specialist",
    description: "Test creation, refactoring, stabilization",
    default: true,
  },
  {
    id: "docs-maintainer",
    name: "Docs maintainer",
    description: "Documentation synchronization with code changes",
    default: true,
  },
  {
    id: "a11y-specialist",
    name: "Accessibility specialist",
    description: "WCAG 2.2 A/AA audit and remediation",
    default: false,
  },
  {
    id: "infrastructure-specialist",
    name: "Infrastructure specialist",
    description: "Build, CI, container, deployment config",
    default: false,
  },
];

export const SKILL_PRESETS: PresetItem[] = [
  {
    id: "patterns",
    name: "Patterns",
    description: "Apply reusable architecture and coding patterns",
    default: true,
  },
  {
    id: "docs-upkeep",
    name: "Docs upkeep",
    description: "Keep docs aligned with implementation changes",
    default: true,
  },
  {
    id: "workspace-hygiene",
    name: "Workspace hygiene",
    description: "Clean workspace state during edits",
    default: true,
  },
];

export const MCP_SERVER_PRESETS: PresetItem[] = [
  {
    id: "interactive",
    name: "Interactive prompts",
    description:
      "User interaction via pop-up prompts (@rawwee/interactive-mcp)",
    default: true,
  },
  {
    id: "context7",
    name: "Context7",
    description: "Library documentation lookup (@upstash/context7-mcp)",
    default: true,
  },
  {
    id: "figma",
    name: "Figma",
    description: "Figma design file access",
    default: false,
  },
  {
    id: "github",
    name: "GitHub Copilot",
    description: "GitHub API via Copilot MCP",
    default: false,
  },
];

export const PLATFORM_CHOICES: PlatformChoice[] = [
  { id: "cursor", name: "Cursor" },
  { id: "claude", name: "Claude Code" },
  { id: "copilot", name: "GitHub Copilot" },
];

export const PACKAGE_MANAGERS: PackageManagerChoice[] = [
  { id: "pnpm", name: "pnpm" },
  { id: "npm", name: "npm" },
  { id: "yarn", name: "yarn" },
];
