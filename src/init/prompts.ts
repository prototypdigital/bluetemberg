import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { basename } from 'node:path';
import {
  RULE_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  MCP_SERVER_PRESETS,
  PLATFORM_CHOICES,
  PACKAGE_MANAGERS,
} from './presets.js';
import type { InitAnswers, Platform, PackageManager } from '../types.js';

export async function runPrompts(targetDir: string): Promise<InitAnswers> {
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

  const rules = await checkbox<string>({
    message: 'Starter rules:',
    choices: RULE_PRESETS.map((r) => ({
      value: r.id,
      name: `${r.name} — ${r.description}`,
      checked: r.default,
    })),
  });

  const includeAgents = await confirm({
    message: 'Include agent orchestration?',
    default: true,
  });

  let agents: string[] = [];
  if (includeAgents) {
    agents = await checkbox<string>({
      message: 'Specialist agents:',
      choices: AGENT_PRESETS.map((a) => ({
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
    skills = await checkbox<string>({
      message: 'Starter skills:',
      choices: SKILL_PRESETS.map((s) => ({
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
    projectName,
    projectDescription,
    packageManager,
    platforms,
    rules,
    includeAgents,
    agents,
    includeSkills,
    skills,
    includeMcp,
    mcpServers,
  };
}
