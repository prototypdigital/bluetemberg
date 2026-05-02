import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { basename } from 'node:path';
import {
  RULE_PRESETS,
  RULE_COLLECTION_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  MCP_SERVER_PRESETS,
  PLATFORM_CHOICES,
  PACKAGE_MANAGERS,
  TEAM_PROFILES,
} from './presets.js';
import type { InitAnswers, Platform, PackageManager, TeamProfile, PresetItem, RuleSource } from '../types.js';

function resolveDefaults(presets: PresetItem[], profile: TeamProfile): PresetItem[] {
  if (profile === 'custom') return presets;

  return presets.map((p) => ({
    ...p,
    default: p.tags?.includes(profile) ?? p.default,
  }));
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
      checked: true,
    })),
    required: true,
  });

  const ruleSource = await select<RuleSource>({
    message: 'Rule source:',
    choices: [
      { value: 'collections', name: 'Rule collections (registry packages)' },
      { value: 'templates', name: 'Individual templates (copied locally)' },
    ],
    default: 'templates',
  });

  let rules: string[] = [];
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
  } else {
    const rulePresets = resolveDefaults(RULE_PRESETS, teamProfile);
    const universalRuleIds = rulePresets
      .filter((r) => r.universal && !r.universalExcludeProfiles?.includes(teamProfile))
      .map((r) => r.id);
    const selectedRules = await checkbox<string>({
      message: 'Starter rules:',
      choices: rulePresets.map((r) => {
        const isForced = r.universal && !r.universalExcludeProfiles?.includes(teamProfile);
        return {
          value: r.id,
          name: `${r.name} — ${r.description}`,
          checked: isForced || r.default,
          disabled: isForced ? '(required)' : false,
        };
      }),
    });
    rules = [...new Set([...universalRuleIds, ...selectedRules])];
  }

  const includeAgents = await confirm({
    message: 'Include agent orchestration?',
    default: true,
  });

  let agents: string[] = [];
  if (includeAgents) {
    const agentPresets = resolveDefaults(AGENT_PRESETS, teamProfile);
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
    const skillPresets = resolveDefaults(SKILL_PRESETS, teamProfile);
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
  };
}
