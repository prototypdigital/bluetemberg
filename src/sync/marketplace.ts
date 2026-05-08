import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
// RULE_PRESETS included for forward-compatibility if rules are ever added to marketplace output
import { RULE_PRESETS, AGENT_PRESETS, SKILL_PRESETS } from '../init/presets.js';
import type { MarketplacePluginDefinition, TeamProfile } from '../types.js';

/** Lookup map from preset ID → profile tags, covering rules, agents, and skills. */
// tags values are constrained to TeamProfile by TEAM_PROFILES — cast is safe
const PRESET_PROFILES: Map<string, TeamProfile[]> = new Map(
  [...RULE_PRESETS, ...AGENT_PRESETS, ...SKILL_PRESETS].map((p) => [p.id, (p.tags ?? []) as TeamProfile[]]),
);

export interface MarketplaceSyncContext extends SyncSink {
  sourceDirs: string[];
  plugins: MarketplacePluginDefinition[];
}

interface ManifestEntry {
  name: string;
  description: string;
  path: string;
}

interface PluginManifest {
  name: string;
  displayName: string;
  description: string;
  skills: ManifestEntry[];
  agents: ManifestEntry[];
  /** Relative path to `hooks/hooks.json` within the plugin dir. Present only when hooks are defined. */
  hooks?: string;
}

interface MarketplaceManifest {
  name: string;
  plugins: Array<{ name: string; description: string; path: string }>;
}

interface FileMeta {
  name: string;
  description: string;
  /** Profiles this file belongs to. Empty = universal (included in all plugins). */
  profiles: TeamProfile[];
}

function resolveProfiles(id: string, frontmatterProfiles: TeamProfile[]): TeamProfile[] {
  if (frontmatterProfiles.length > 0) return frontmatterProfiles;
  return PRESET_PROFILES.get(id) ?? [];
}

function readSkillMeta(skillDir: string, sourceParent: string): FileMeta {
  const skillPath = join(sourceParent, skillDir, 'SKILL.md');
  try {
    const { data } = matter.read(skillPath);
    return {
      name: (data.name as string) || skillDir,
      description: (data.description as string) || '',
      profiles: resolveProfiles(skillDir, (data.profiles as TeamProfile[]) || []),
    };
  } catch {
    return { name: skillDir, description: '', profiles: resolveProfiles(skillDir, []) };
  }
}

function readAgentMeta(agentFile: string, sourceDir: string): FileMeta {
  const agentPath = join(sourceDir, agentFile);
  const id = basename(agentFile, '.md');
  try {
    const { data } = matter.read(agentPath);
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, (data.profiles as TeamProfile[]) || []),
    };
  } catch {
    return { name: id, description: '', profiles: resolveProfiles(id, []) };
  }
}

/** Returns true if a file should be included in a plugin.
 *  Universal files (no profiles) are always included.
 *  Tagged files are included only when at least one profile matches.
 */
function matchesPlugin(fileMeta: FileMeta, pluginProfiles: TeamProfile[] | undefined): boolean {
  if (!pluginProfiles || pluginProfiles.length === 0) return true;
  if (fileMeta.profiles.length === 0) return true;
  return fileMeta.profiles.some((p) => pluginProfiles.includes(p));
}

/**
 * Reads `claude-hooks.json` from source dirs in priority order.
 * Returns the raw file content of the first match, or null if not found.
 */
function readHooksContent(sourceDirs: string[]): string | null {
  for (const dir of sourceDirs) {
    const hooksPath = join(dir, 'claude-hooks.json');
    if (existsSync(hooksPath)) {
      try {
        return readFileSync(hooksPath, 'utf8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function emitPlugin(
  ctx: MarketplaceSyncContext,
  plugin: MarketplacePluginDefinition,
  allSkills: Map<string, string>,
  allAgents: Map<string, string>,
  hooksContent: string | null,
  recordError: (msg: string) => void,
): PluginManifest {
  const pluginDir = join(ctx.root, 'plugins', plugin.name);
  const skillsDir = join(pluginDir, 'skills');
  const agentsDir = join(pluginDir, 'agents');
  const manifestDir = join(pluginDir, '.claude-plugin');

  ensureDir(pluginDir);
  ensureDir(skillsDir);
  ensureDir(agentsDir);
  ensureDir(manifestDir);

  const skillEntries: ManifestEntry[] = [];
  const agentEntries: ManifestEntry[] = [];

  for (const [dirName, sourceParent] of allSkills) {
    const meta = readSkillMeta(dirName, sourceParent);
    if (!matchesPlugin(meta, plugin.profiles)) continue;

    const srcPath = join(sourceParent, dirName, 'SKILL.md');
    const outSkillDir = join(skillsDir, dirName);
    ensureDir(outSkillDir);

    try {
      const content = readFileSync(srcPath, 'utf8');
      commitPlannedWrite(ctx, join(outSkillDir, 'SKILL.md'), content);
      skillEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/skills/${dirName}/SKILL.md`,
      });
    } catch {
      recordError(`marketplace: could not read skill ${dirName}`);
    }
  }

  for (const [file, sourceDir] of allAgents) {
    const meta = readAgentMeta(file, sourceDir);
    if (!matchesPlugin(meta, plugin.profiles)) continue;

    const srcPath = join(sourceDir, file);
    const outPath = join(agentsDir, file);

    try {
      const content = readFileSync(srcPath, 'utf8');
      commitPlannedWrite(ctx, outPath, content);
      agentEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/agents/${file}`,
      });
    } catch {
      recordError(`marketplace: could not read agent ${file}`);
    }
  }

  let hooks: string | undefined;
  if (hooksContent !== null) {
    const hooksDir = join(pluginDir, 'hooks');
    ensureDir(hooksDir);
    const hooksOutPath = join(hooksDir, 'hooks.json');
    commitPlannedWrite(ctx, hooksOutPath, hooksContent);
    hooks = `plugins/${plugin.name}/hooks/hooks.json`;
  }

  return {
    name: plugin.name,
    displayName: plugin.displayName ?? plugin.name,
    description: plugin.description ?? '',
    skills: skillEntries,
    agents: agentEntries,
    ...(hooks !== undefined ? { hooks } : {}),
  };
}

export function syncMarketplace(ctx: MarketplaceSyncContext, recordError: (msg: string) => void): void {
  const allSkills = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  const allAgents = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');

  if (allSkills.size === 0 && allAgents.size === 0) return;

  const hooksContent = readHooksContent(ctx.sourceDirs);
  const projectName = basename(ctx.root);

  ctx.log(
    `Marketplace: ${ctx.plugins.length} plugin(s), ${allSkills.size} skill(s), ${allAgents.size} agent(s)${hooksContent !== null ? ', hooks' : ''}`,
  );

  ensureDir(join(ctx.root, '.claude-plugin'));

  const pluginManifests: PluginManifest[] = [];

  for (const pluginDef of ctx.plugins) {
    const manifest = emitPlugin(ctx, pluginDef, allSkills, allAgents, hooksContent, recordError);
    pluginManifests.push(manifest);

    const pluginJsonObj: Record<string, unknown> = {
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      skills: manifest.skills,
      agents: manifest.agents,
      ...(manifest.hooks !== undefined ? { hooks: manifest.hooks } : {}),
    };

    commitPlannedWrite(
      ctx,
      join(ctx.root, 'plugins', pluginDef.name, '.claude-plugin', 'plugin.json'),
      JSON.stringify(pluginJsonObj, null, 2),
    );

    if (!ctx.checkMode) {
      const hooksNote = manifest.hooks !== undefined ? ', hooks' : '';
      ctx.log(
        `  -> plugins/${pluginDef.name}/ (${manifest.skills.length} skills, ${manifest.agents.length} agents${hooksNote})`,
      );
    }
  }

  const marketplace: MarketplaceManifest = {
    name: projectName,
    plugins: pluginManifests.map((p) => ({
      name: p.name,
      description: p.description,
      path: `plugins/${p.name}`,
    })),
  };

  commitPlannedWrite(
    ctx,
    join(ctx.root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(marketplace, null, 2),
  );

  if (!ctx.checkMode) {
    ctx.log(`  -> .claude-plugin/marketplace.json`);
  }
}
