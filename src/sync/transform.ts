import type { Platform, RuleFrontmatter, TargetConfig, SkillTargetConfig } from '../types.js';

interface CursorFrontmatter {
  description: string;
  alwaysApply?: boolean;
  globs?: string[];
}

interface ClaudeFrontmatter {
  description: string;
  paths: string[];
}

interface CopilotFrontmatter {
  description: string;
  applyTo: string;
}

interface GeminiFrontmatter {
  description: string;
  glob: string;
}

/**
 * Devin Desktop (formerly Windsurf) workspace rule, `.devin/rules/*.md`. Antigravity's
 * `.agents/rules/*.md` uses the same shape.
 */
interface DevinFrontmatter {
  trigger: 'always_on' | 'glob';
  description: string;
  globs?: string;
}

export type TransformedFrontmatter =
  CursorFrontmatter | ClaudeFrontmatter | CopilotFrontmatter | GeminiFrontmatter | DevinFrontmatter;

export function transformFrontmatter(data: RuleFrontmatter, platform: Platform): TransformedFrontmatter {
  const description = data.description || '';
  const scope = data.scope || '**';

  switch (platform) {
    case 'cursor': {
      if (scope === '**') {
        return { description, alwaysApply: true };
      }
      return { description, globs: Array.isArray(scope) ? scope : [scope] };
    }

    case 'claude':
      return { description, paths: Array.isArray(scope) ? scope : [scope] };

    case 'copilot':
      return {
        description,
        applyTo: Array.isArray(scope) ? scope.join(',') : scope,
      };

    case 'gemini':
      return {
        description,
        glob: Array.isArray(scope) ? scope.join(',') : scope,
      };

    case 'devin':
    case 'windsurf':
    case 'antigravity': {
      if (scope === '**') {
        return { trigger: 'always_on', description };
      }
      return { trigger: 'glob', description, globs: Array.isArray(scope) ? scope.join(',') : scope };
    }

    default:
      throw new Error(`Unknown platform: ${platform as string}`);
  }
}

export const DEFAULT_TARGETS: {
  rules: Partial<Record<Platform, TargetConfig>>;
  agents: Partial<Record<Platform, TargetConfig>>;
  skills: Partial<Record<Platform, SkillTargetConfig>>;
} = {
  rules: {
    cursor: { dir: '.cursor/rules', ext: '.mdc' },
    claude: { dir: '.claude/rules', ext: '.md' },
    copilot: { dir: '.github/instructions', ext: '.instructions.md' },
    // Gemini CLI has no per-path rule directory: it reads `AGENTS.md` (via `.gemini/settings.json`),
    // where its rules land in the managed block. See Architecture.md "Special sync".
    devin: { dir: '.devin/rules', ext: '.md' },
    // Antigravity scans the immediate `.md` files in `.agents/rules/`, keyed on `trigger` / `globs`.
    antigravity: { dir: '.agents/rules', ext: '.md' },
  },
  agents: {
    cursor: { dir: '.cursor/agents', ext: '.md' },
    claude: { dir: '.claude/agents', ext: '.md' },
    copilot: { dir: '.github/agents', ext: '.agent.md' },
  },
  skills: {
    cursor: { dir: '.cursor/skills' },
    claude: { dir: '.claude/skills' },
    copilot: { dir: '.github/skills' },
    // Codex, Devin Desktop and Antigravity all scan `.agents/skills/` (vendor-neutral) for project-level
    // skills; the SKILL.md + name/description frontmatter shape already matches our source.
    // The shared dir is written once (see `resolveSkillTargets`).
    devin: { dir: '.agents/skills' },
    codex: { dir: '.agents/skills' },
    antigravity: { dir: '.agents/skills' },
  },
};
