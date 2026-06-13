import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { basename } from 'node:path';
import { MARKETPLACE_PLATFORM } from '../types.js';
import {
  RULE_COLLECTION_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  MCP_SERVER_PRESETS,
  PLATFORM_CHOICES,
  PACKAGE_MANAGERS,
  TEAM_PROFILES,
  MARKETPLACE_PLUGIN_PACKS,
  GITHUB_FEATURE_PRESETS,
} from './presets.js';
import type {
  InitAnswers,
  Platform,
  PackageManager,
  TeamProfile,
  RuleSource,
  GitHubScaffoldConfig,
} from '../types.js';
import { resolvePresetDefaults } from './preset-resolution.js';

function defaultMarketplacePacks(teamProfile: TeamProfile): string[] {
  switch (teamProfile) {
    case 'frontend':
      return ['frontend'];
    case 'backend':
      return ['backend'];
    case 'fullstack':
      return ['frontend', 'fullstack', 'backend'];
    case 'devops':
    case 'pure-infra':
      return ['devops'];
    case 'custom':
      return MARKETPLACE_PLUGIN_PACKS.map((p) => p.id);
  }
}

export async function runPrompts(targetDir: string): Promise<InitAnswers> {
  const teamProfile = await select<TeamProfile>({
    message: 'Team profile:',
    choices: TEAM_PROFILES.map((t) => ({
      value: t.id,
      name: `${t.name} — ${t.description}`,
    })),
    default: 'fullstack',
  });

  const projectName = await input({
    message: 'Project name:',
    default: basename(targetDir),
  });

  const projectDescription = await input({
    message: 'Project description (one line):',
    default: '',
  });

  const packageManager = await select<PackageManager>({
    message: 'Package manager:',
    choices: PACKAGE_MANAGERS.map((pm) => ({ value: pm.id, name: pm.name })),
    default: 'pnpm',
  });

  const platforms = await checkbox<Platform>({
    message: 'Target platforms:',
    choices: PLATFORM_CHOICES.map((p) => ({
      value: p.id,
      name: p.name,
      checked: p.id !== MARKETPLACE_PLATFORM,
    })),
    required: true,
  });

  let marketplaceRemote = '';
  let marketplacePlugins: string[] = [];

  if (platforms.includes(MARKETPLACE_PLATFORM)) {
    marketplaceRemote = await input({
      message: 'Marketplace remote repo (owner/repo, leave blank to skip):',
      default: '',
    });

    const defaults = defaultMarketplacePacks(teamProfile);
    marketplacePlugins = await checkbox<string>({
      message: 'Plugin packs to distribute:',
      choices: MARKETPLACE_PLUGIN_PACKS.map((p) => ({
        value: p.id,
        name: `${p.displayName} — ${p.description}`,
        checked: defaults.includes(p.id),
      })),
    });
  }

  const ruleSource = await select<RuleSource>({
    message: 'Rule source:',
    choices: [
      { value: 'collections', name: 'Rule collections (registry packages)' },
      { value: 'none', name: 'Empty — bring your own rules' },
    ],
    default: 'collections',
  });

  const rules: string[] = [];
  let ruleCollections: string[] = [];

  if (ruleSource === 'collections') {
    const collectionChoices = RULE_COLLECTION_PRESETS.map((c) => ({
      value: c.id,
      name: `${c.name} — ${c.description}`,
      checked: teamProfile === 'custom' ? false : (c.tags?.includes(teamProfile) ?? false),
    }));

    ruleCollections = await checkbox<string>({
      message: 'Rule collections:',
      choices: collectionChoices,
    });
  }

  const includeAgents = await confirm({
    message: 'Include agent orchestration?',
    default: true,
  });

  let agents: string[] = [];
  if (includeAgents) {
    const agentPresets = resolvePresetDefaults(AGENT_PRESETS, teamProfile);
    agents = await checkbox<string>({
      message: 'Specialist agents:',
      choices: agentPresets.map((a) => ({
        value: a.id,
        name: `${a.name} — ${a.description}`,
        checked: a.default,
      })),
    });
  }

  const includeSkills = await confirm({
    message: 'Include skills scaffolding?',
    default: true,
  });

  let skills: string[] = [];
  if (includeSkills) {
    const skillPresets = resolvePresetDefaults(SKILL_PRESETS, teamProfile);
    skills = await checkbox<string>({
      message: 'Starter skills:',
      choices: skillPresets.map((s) => ({
        value: s.id,
        name: `${s.name} — ${s.description}`,
        checked: s.default,
      })),
    });
  }

  const includeMcp = await confirm({
    message: 'Include MCP server configs?',
    default: true,
  });

  let mcpServers: string[] = [];
  if (includeMcp) {
    mcpServers = await checkbox<string>({
      message: 'MCP servers:',
      choices: MCP_SERVER_PRESETS.map((m) => ({
        value: m.id,
        name: `${m.name} — ${m.description}`,
        checked: m.default,
      })),
    });
  }

  const includeExternalSources = await confirm({
    message: 'Add external rule sources? (github, prpm, cursor.directory)',
    default: false,
  });

  let externalSources: string[] = [];
  if (includeExternalSources) {
    const raw = await input({
      message: 'Source specs (comma-separated, e.g. github:PatrickJS/awesome-cursorrules#HEAD:rules):',
      default: '',
    });
    externalSources = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const includeGithub = await confirm({
    message: 'Scaffold GitHub repository files (CI, security scanning, templates)?',
    default: true,
  });

  let github: GitHubScaffoldConfig | undefined;
  if (includeGithub) {
    const selectedIds = await checkbox<string>({
      message: 'GitHub features to scaffold:',
      choices: GITHUB_FEATURE_PRESETS.map((f) => ({
        value: f.id,
        name: `${f.name} — ${f.description}`,
        checked: f.default,
      })),
    });
    github = buildGithubConfig(selectedIds);
  }

  return {
    teamProfile,
    projectName,
    projectDescription,
    packageManager,
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
    marketplaceRemote,
    marketplacePlugins,
    externalSources,
    github,
  };
}

function buildGithubConfig(selectedIds: string[]): GitHubScaffoldConfig {
  const s = new Set(selectedIds);
  return {
    ci: s.has('ci'),
    codeql: s.has('codeql'),
    dependencyReview: s.has('dependencyReview'),
    dependabot: s.has('dependabot'),
    issueTemplates: s.has('issueTemplates'),
    prTemplate: s.has('prTemplate'),
    codeowners: s.has('codeowners'),
    releaseWorkflow: s.has('releaseWorkflow'),
    staleBot: s.has('staleBot'),
    pagesWorkflow: s.has('pagesWorkflow'),
  };
}
