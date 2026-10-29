import { basename } from 'node:path';
import { MARKETPLACE_PLATFORM } from '../types.js';
import type { InitAnswers, Platform, TeamProfile } from '../types.js';
import { type Catalog, loadCatalogSync } from '../catalog/index.js';
import { detectStacks } from '../stacks/detect.js';
import { preselectedCollectionIds, resolvePresetDefaults } from './preset-resolution.js';
import {
  resolveRuleCollections,
  resolveAgents,
  resolveSkills,
  MCP_SERVER_PRESETS,
  PLATFORM_CHOICES,
  GUARDRAIL_PRESETS,
  DEFAULT_GITHUB_CONFIG,
} from './presets.js';

/**
 * Stacks that gate preselection: an explicit `stacks` answer (`--stacks`, `--config`) wins,
 * otherwise whatever `detectStacks` finds in the target directory.
 */
export function projectStacksFor(targetDir: string, stacks?: Record<string, string>): Set<string> {
  if (stacks !== undefined) return new Set(Object.keys(stacks));
  return new Set(detectStacks(targetDir).keys());
}

export function defaultRuleCollections(
  teamProfile: TeamProfile,
  catalog: Catalog,
  projectStacks: ReadonlySet<string>,
): string[] {
  return preselectedCollectionIds(resolveRuleCollections(catalog), teamProfile, projectStacks);
}

export function agentsForProfile(
  teamProfile: TeamProfile,
  catalog: Catalog,
  projectStacks: ReadonlySet<string>,
): string[] {
  const resolved = resolvePresetDefaults(resolveAgents(catalog), teamProfile, projectStacks);
  return resolved.filter((a) => a.default).map((a) => a.id);
}

export function skillsForProfile(
  teamProfile: TeamProfile,
  catalog: Catalog,
  projectStacks: ReadonlySet<string>,
): string[] {
  const resolved = resolvePresetDefaults(resolveSkills(catalog), teamProfile, projectStacks);
  return resolved.filter((s) => s.default).map((s) => s.id);
}

function defaultMcpServerIds(): string[] {
  return MCP_SERVER_PRESETS.filter((m) => m.default).map((m) => m.id);
}

function defaultGuardrailIds(teamProfile: TeamProfile): string[] {
  const resolved = resolvePresetDefaults(GUARDRAIL_PRESETS, teamProfile, new Set());
  return resolved.filter((g) => g.default).map((g) => g.id);
}

/**
 * Baseline identical to submitting the wizard with only profile-based checkbox defaults:
 * collections source, all platforms checked, agents/skills/MCP inclusion with wizard defaults.
 * Stack-specific packs are preselected only for stacks in `projectStacks` (detected by default).
 */
export function buildInitAnswersFromProfile(
  teamProfile: TeamProfile,
  targetDir: string,
  catalog?: Catalog,
  projectStacks: ReadonlySet<string> = projectStacksFor(targetDir),
): InitAnswers {
  const resolvedCatalog = catalog ?? loadCatalogSync(targetDir);
  return {
    teamProfile,
    projectName: basename(targetDir),
    projectDescription: '',
    packageManager: 'pnpm',
    platforms: PLATFORM_CHOICES.filter((p) => p.id !== MARKETPLACE_PLATFORM).map((p) => p.id) as Platform[],
    ruleSource: 'collections',
    rules: [],
    ruleCollections: defaultRuleCollections(teamProfile, resolvedCatalog, projectStacks),
    includeAgents: true,
    agents: agentsForProfile(teamProfile, resolvedCatalog, projectStacks),
    includeSkills: true,
    skills: skillsForProfile(teamProfile, resolvedCatalog, projectStacks),
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
  const catalog = loadCatalogSync(targetDir);
  const base = buildInitAnswersFromProfile(
    teamProfile,
    targetDir,
    catalog,
    projectStacksFor(targetDir, overrides.stacks),
  );

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
        : base.ruleCollections;
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
    // Stacks are not part of the profile baseline (sync auto-detects); only an explicit
    // `--stacks` override pins them into the config.
    stacks: overrides.stacks,
    // `--omit-github` sets the key to undefined on purpose, so presence (not value) decides.
    github: Object.hasOwn(overrides, 'github') ? overrides.github : base.github,
  };
}
