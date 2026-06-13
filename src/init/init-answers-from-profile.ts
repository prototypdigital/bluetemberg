import { basename } from 'node:path';
import { MARKETPLACE_PLATFORM } from '../types.js';
import type { InitAnswers, Platform, RuleCollectionPreset, TeamProfile } from '../types.js';
import { resolvePresetDefaults } from './preset-resolution.js';
import {
  RULE_COLLECTION_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  MCP_SERVER_PRESETS,
  PLATFORM_CHOICES,
  GUARDRAIL_PRESETS,
  DEFAULT_GITHUB_CONFIG,
} from './presets.js';

export function defaultRuleCollections(teamProfile: TeamProfile): string[] {
  if (teamProfile === 'custom') return [];
  return RULE_COLLECTION_PRESETS.filter(
    (c: RuleCollectionPreset) => c.tags?.includes(teamProfile) ?? false,
  ).map((c) => c.id);
}

export function agentsForProfile(teamProfile: TeamProfile): string[] {
  const resolved = resolvePresetDefaults(AGENT_PRESETS, teamProfile);
  return resolved.filter((a) => a.default).map((a) => a.id);
}

export function skillsForProfile(teamProfile: TeamProfile): string[] {
  const resolved = resolvePresetDefaults(SKILL_PRESETS, teamProfile);
  return resolved.filter((s) => s.default).map((s) => s.id);
}

function defaultMcpServerIds(): string[] {
  return MCP_SERVER_PRESETS.filter((m) => m.default).map((m) => m.id);
}

function defaultGuardrailIds(teamProfile: TeamProfile): string[] {
  const resolved = resolvePresetDefaults(GUARDRAIL_PRESETS, teamProfile);
  return resolved.filter((g) => g.default).map((g) => g.id);
}

/**
 * Baseline identical to submitting the wizard with only profile-based checkbox defaults:
 * collections source, all platforms checked, agents/skills/MCP inclusion with wizard defaults.
 */
export function buildInitAnswersFromProfile(teamProfile: TeamProfile, targetDir: string): InitAnswers {
  return {
    teamProfile,
    projectName: basename(targetDir),
    projectDescription: '',
    packageManager: 'pnpm',
    platforms: PLATFORM_CHOICES.filter((p) => p.id !== MARKETPLACE_PLATFORM).map((p) => p.id) as Platform[],
    ruleSource: 'collections',
    rules: [],
    ruleCollections: defaultRuleCollections(teamProfile),
    includeAgents: true,
    agents: agentsForProfile(teamProfile),
    includeSkills: true,
    skills: skillsForProfile(teamProfile),
    includeMcp: true,
    mcpServers: defaultMcpServerIds(),
    marketplaceRemote: '',
    marketplacePlugins: [],
    includeGuardrails: true,
    guardrails: defaultGuardrailIds(teamProfile),
    externalSources: [],
    github: { ...DEFAULT_GITHUB_CONFIG },
  };
}

/** Build init answers without prompts. Only passes defined fields from `overrides` onto the baseline for `profile`. */
export function finalizeNonInteractiveAnswers(
  profile: TeamProfile,
  targetDir: string,
  overrides: Partial<InitAnswers>,
): InitAnswers {
  const teamProfile = overrides.teamProfile ?? profile;
  const base = buildInitAnswersFromProfile(teamProfile, targetDir);

  let ruleSource = base.ruleSource;
  if (overrides.ruleSource !== undefined) ruleSource = overrides.ruleSource;

  const platforms: Platform[] =
    overrides.platforms !== undefined && overrides.platforms.length > 0
      ? overrides.platforms
      : base.platforms;

  let ruleCollections = base.ruleCollections;
  const rules: string[] = [];
  if (ruleSource === 'none') {
    ruleCollections = [];
  } else {
    ruleCollections =
      overrides.ruleCollections !== undefined && overrides.ruleCollections.length > 0
        ? overrides.ruleCollections
        : defaultRuleCollections(teamProfile);
  }

  const includeAgents = overrides.includeAgents ?? base.includeAgents;
  const agents = includeAgents ? (overrides.agents ?? base.agents) : [];

  const includeSkills = overrides.includeSkills ?? base.includeSkills;
  const skills = includeSkills ? (overrides.skills ?? base.skills) : [];

  const includeMcp = overrides.includeMcp ?? base.includeMcp;
  const mcpServers = includeMcp ? (overrides.mcpServers ?? base.mcpServers) : [];

  return {
    teamProfile,
    projectName: overrides.projectName ?? base.projectName,
    projectDescription:
      overrides.projectDescription !== undefined ? overrides.projectDescription : base.projectDescription,
    packageManager: overrides.packageManager ?? base.packageManager,
    platforms,
    ruleSource,
    rules,
    ruleCollections,
    includeAgents,
    agents,
    includeSkills,
    skills,
    includeMcp,
    mcpServers,
    marketplaceRemote: overrides.marketplaceRemote ?? base.marketplaceRemote,
    marketplacePlugins: overrides.marketplacePlugins ?? base.marketplacePlugins,
    includeGuardrails: overrides.includeGuardrails ?? base.includeGuardrails,
    guardrails: overrides.guardrails ?? base.guardrails,
    externalSources: overrides.externalSources ?? base.externalSources,
    github: overrides.github ?? base.github,
  };
}
