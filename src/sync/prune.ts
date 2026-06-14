import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MARKETPLACE_PLATFORM } from '../types.js';
import type { BlueprintConfig, Platform, SkillTargetConfig, TargetConfig } from '../types.js';
import { DEFAULT_TARGETS } from './transform.js';
import { filterTargets } from '../utils/target-filtering.js';

function pruneRulesAndAgents(
  root: string,
  platforms: Platform[],
  section: Partial<Record<Platform, TargetConfig>>,
  expected: Set<string>,
): number {
  const targets = filterTargets(section, platforms);
  let removed = 0;
  for (const [, tc] of targets) {
    const dir = join(root, tc.dir);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(tc.ext)) {
        continue;
      }
      const abs = resolve(join(dir, name));
      if (!expected.has(abs)) {
        unlinkSync(abs);
        removed++;
      }
    }
  }
  return removed;
}

function pruneSkills(
  root: string,
  platforms: Platform[],
  section: Partial<Record<Platform, SkillTargetConfig>>,
  expected: Set<string>,
): number {
  const targets = filterTargets<SkillTargetConfig>(section, platforms);
  let removed = 0;
  for (const [, tc] of targets) {
    const base = join(root, tc.dir);
    if (!existsSync(base)) {
      continue;
    }
    for (const ent of readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) {
        continue;
      }
      const skillMd = join(base, ent.name, 'SKILL.md');
      if (!existsSync(skillMd)) {
        continue;
      }
      const abs = resolve(skillMd);
      if (!expected.has(abs)) {
        unlinkSync(abs);
        removed++;
        try {
          rmdirSync(join(base, ent.name));
        } catch {
          // directory not empty or race — ignore
        }
      }
    }
  }
  return removed;
}

function pruneCommandsDir(root: string, expected: Set<string>): number {
  const dir = join(root, '.claude', 'commands');
  if (!existsSync(dir)) {
    return 0;
  }
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'README.md') {
      continue;
    }
    const abs = resolve(join(dir, name));
    if (!expected.has(abs)) {
      unlinkSync(abs);
      removed++;
    }
  }
  return removed;
}

function pruneCodexAgentsDir(root: string, expected: Set<string>): number {
  const dir = join(root, '.codex', 'agents');
  if (!existsSync(dir)) {
    return 0;
  }
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.toml')) {
      continue;
    }
    const abs = resolve(join(dir, name));
    if (!expected.has(abs)) {
      unlinkSync(abs);
      removed++;
    }
  }
  return removed;
}

function prunePromptsDir(root: string, expected: Set<string>): number {
  const dir = join(root, '.github', 'prompts');
  if (!existsSync(dir)) {
    return 0;
  }
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.prompt.md')) {
      continue;
    }
    const abs = resolve(join(dir, name));
    if (!expected.has(abs)) {
      unlinkSync(abs);
      removed++;
    }
  }
  return removed;
}

function pruneMarketplace(root: string, expected: Set<string>): number {
  let removed = 0;

  const pluginsBase = join(root, 'plugins');
  if (existsSync(pluginsBase)) {
    for (const pluginEnt of readdirSync(pluginsBase, { withFileTypes: true })) {
      if (!pluginEnt.isDirectory()) continue;
      const pluginDir = join(pluginsBase, pluginEnt.name);

      const skillsDir = join(pluginDir, 'skills');
      if (existsSync(skillsDir)) {
        for (const skillEnt of readdirSync(skillsDir, { withFileTypes: true })) {
          if (!skillEnt.isDirectory()) continue;
          const skillMd = join(skillsDir, skillEnt.name, 'SKILL.md');
          if (!existsSync(skillMd)) continue;
          const abs = resolve(skillMd);
          if (!expected.has(abs)) {
            unlinkSync(abs);
            removed++;
            try {
              rmdirSync(join(skillsDir, skillEnt.name));
            } catch {
              // directory not empty — ignore
            }
          }
        }
        try {
          rmdirSync(skillsDir);
        } catch {
          // directory not empty — ignore
        }
      }

      const rulesDir = join(pluginDir, 'rules');
      if (existsSync(rulesDir)) {
        for (const name of readdirSync(rulesDir)) {
          if (!name.endsWith('.md')) continue;
          const abs = resolve(join(rulesDir, name));
          if (!expected.has(abs)) {
            unlinkSync(abs);
            removed++;
          }
        }
        try {
          rmdirSync(rulesDir);
        } catch {
          // directory not empty — ignore
        }
      }

      const agentsDir = join(pluginDir, 'agents');
      if (existsSync(agentsDir)) {
        for (const name of readdirSync(agentsDir)) {
          if (!name.endsWith('.md')) continue;
          const abs = resolve(join(agentsDir, name));
          if (!expected.has(abs)) {
            unlinkSync(abs);
            removed++;
          }
        }
        try {
          rmdirSync(agentsDir);
        } catch {
          // directory not empty — ignore
        }
      }

      const pluginJson = join(pluginDir, '.claude-plugin', 'plugin.json');
      removed += pruneSingletonIfStale(pluginJson, expected);

      const hooksJson = join(pluginDir, 'hooks', 'hooks.json');
      removed += pruneSingletonIfStale(hooksJson, expected);

      try {
        rmdirSync(join(pluginDir, '.claude-plugin'));
      } catch {
        // directory not empty — ignore
      }
      try {
        rmdirSync(pluginDir);
      } catch {
        // directory not empty — ignore
      }
    }
    try {
      rmdirSync(pluginsBase);
    } catch {
      // directory not empty — ignore
    }
  }

  removed += pruneSingletonIfStale(join(root, '.claude-plugin', 'marketplace.json'), expected);

  return removed;
}

function pruneSingletonIfStale(absPath: string, expected: Set<string>): number {
  if (!existsSync(absPath)) {
    return 0;
  }
  const abs = resolve(absPath);
  if (expected.has(abs)) {
    return 0;
  }
  unlinkSync(abs);
  return 1;
}

/**
 * Removes generated files under known output locations that were not produced in the current sync pass.
 * Only runs after a write-mode sync; callers must pass the same `expected` set populated by `commitPlannedWrite`.
 */
export function pruneStaleOutputs(args: {
  root: string;
  config: BlueprintConfig;
  platforms: Platform[];
  expectedPaths: Set<string>;
  log: (...args: unknown[]) => void;
}): void {
  const { root, config, platforms, expectedPaths, log } = args;
  let total = 0;

  const rulesSection = config.targets?.rules || DEFAULT_TARGETS.rules;
  const agentsSection = config.targets?.agents || DEFAULT_TARGETS.agents;
  const skillsSection = config.targets?.skills || DEFAULT_TARGETS.skills;

  total += pruneRulesAndAgents(root, platforms, rulesSection, expectedPaths);
  if (agentsSection) {
    total += pruneRulesAndAgents(root, platforms, agentsSection, expectedPaths);
  }
  if (skillsSection) {
    total += pruneSkills(root, platforms, skillsSection, expectedPaths);
  }

  if (platforms.includes('claude')) {
    total += pruneCommandsDir(root, expectedPaths);
  }

  if (platforms.includes('copilot')) {
    total += prunePromptsDir(root, expectedPaths);
  }

  if (platforms.includes('codex')) {
    total += pruneCodexAgentsDir(root, expectedPaths);
  }

  if (platforms.includes('copilot')) {
    total += pruneSingletonIfStale(join(root, '.github', 'copilot-instructions.md'), expectedPaths);
  }
  if (platforms.includes('gemini')) {
    total += pruneSingletonIfStale(join(root, 'GEMINI.md'), expectedPaths);
  }

  if (platforms.includes('claude')) {
    total += pruneSingletonIfStale(join(root, '.claude', 'mcp.json'), expectedPaths);
  }
  if (platforms.includes('copilot')) {
    total += pruneSingletonIfStale(join(root, '.github', 'mcp.json'), expectedPaths);
  }
  if (platforms.includes('cursor')) {
    total += pruneSingletonIfStale(join(root, '.cursor', 'mcp.json'), expectedPaths);
  }

  if (platforms.includes('cursor')) {
    total += pruneSingletonIfStale(join(root, '.cursor', 'hooks.json'), expectedPaths);
  }

  if (platforms.includes(MARKETPLACE_PLATFORM)) {
    total += pruneMarketplace(root, expectedPaths);
  }

  if (total > 0) {
    log(`\nPrune: removed ${total} stale generated file(s).`);
  }
}
