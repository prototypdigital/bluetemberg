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

interface WindsurfFrontmatter {
  trigger: 'always_on' | 'glob';
  description: string;
  glob?: string;
}

export type TransformedFrontmatter =
  | CursorFrontmatter
  | ClaudeFrontmatter
  | CopilotFrontmatter
  | GeminiFrontmatter
  | WindsurfFrontmatter;

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

    case 'windsurf': {
      if (scope === '**') {
        return { trigger: 'always_on', description };
      }
      return { trigger: 'glob', description, glob: Array.isArray(scope) ? scope.join(',') : scope };
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
    gemini: { dir: '.gemini/context', ext: '.md' },
    windsurf: { dir: '.windsurf/rules', ext: '.md' },
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
    windsurf: { dir: '.windsurf/skills' },
  },
};
