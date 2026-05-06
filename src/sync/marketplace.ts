import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import type { MarketplacePluginDefinition, TeamProfile } from '../types.js';

interface MarketplaceSyncContext extends SyncSink {
  sourceDirs: string[];
  projectName: string;
  plugins: MarketplacePluginDefinition[];
}

interface SkillManifestEntry {
  name: string;
  description: string;
  path: string;
}

interface AgentManifestEntry {
  name: string;
  description: string;
  path: string;
}

interface PluginManifest {
  name: string;
  displayName: string;
  description: string;
  skills: SkillManifestEntry[];
  agents: AgentManifestEntry[];
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

function readSkillMeta(skillDir: string, sourceParent: string): FileMeta {
  const skillPath = join(sourceParent, skillDir, 'SKILL.md');
  try {
    const { data } = matter.read(skillPath);
    return {
      name: (data.name as string) || skillDir,
      description: (data.description as string) || '',
      profiles: (data.profiles as TeamProfile[]) || [],
    };
  } catch {
    return { name: skillDir, description: '', profiles: [] };
  }
}

function readAgentMeta(agentFile: string, sourceDir: string): FileMeta {
  const agentPath = join(sourceDir, agentFile);
  try {
    const { data } = matter.read(agentPath);
    return {
      name: (data.name as string) || basename(agentFile, '.md'),
      description: (data.description as string) || '',
      profiles: (data.profiles as TeamProfile[]) || [],
    };
  } catch {
    return { name: basename(agentFile, '.md'), description: '', profiles: [] };
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

function emitPlugin(
  ctx: MarketplaceSyncContext,
  plugin: MarketplacePluginDefinition,
  allSkills: Map<string, string>,
  allAgents: Map<string, string>,
): PluginManifest {
  const pluginDir = join(ctx.root, 'plugins', plugin.name);
  const skillsDir = join(pluginDir, 'skills');
  const agentsDir = join(pluginDir, 'agents');

  ensureDir(pluginDir);
  ensureDir(skillsDir);
  ensureDir(agentsDir);

  const skillEntries: SkillManifestEntry[] = [];
  const agentEntries: AgentManifestEntry[] = [];

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
      ctx.results.warnings.push(`marketplace: could not read skill ${dirName}`);
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
      ctx.results.warnings.push(`marketplace: could not read agent ${file}`);
    }
  }

  return {
    name: plugin.name,
    displayName: plugin.displayName ?? plugin.name,
    description: plugin.description ?? '',
    skills: skillEntries,
    agents: agentEntries,
  };
}

export function syncMarketplace(
  sink: SyncSink,
  sourceDirs: string[],
  projectName: string,
  pluginDefs: MarketplacePluginDefinition[],
): void {
  const allSkills = mergeSourceDirs(sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  const allAgents = mergeSourceFiles(sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');

  if (allSkills.size === 0 && allAgents.size === 0) return;

  const ctx: MarketplaceSyncContext = {
    ...sink,
    sourceDirs,
    projectName,
    plugins: pluginDefs,
  };

  sink.log(`Marketplace: ${pluginDefs.length} plugin(s), ${allSkills.size} skill(s), ${allAgents.size} agent(s)`);

  ensureDir(join(sink.root, '.claude-plugin'));

  const pluginManifests: PluginManifest[] = [];

  for (const pluginDef of pluginDefs) {
    const manifest = emitPlugin(ctx, pluginDef, allSkills, allAgents);
    pluginManifests.push(manifest);

    const pluginJson = JSON.stringify(
      {
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description,
        skills: manifest.skills,
        agents: manifest.agents,
      },
      null,
      2,
    );
    commitPlannedWrite(ctx, join(sink.root, 'plugins', pluginDef.name, '.claude-plugin', 'plugin.json'), pluginJson);

    if (!sink.checkMode) {
      sink.log(`  -> plugins/${pluginDef.name}/ (${manifest.skills.length} skills, ${manifest.agents.length} agents)`);
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
    join(sink.root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(marketplace, null, 2),
  );

  if (!sink.checkMode) {
    sink.log(`  -> .claude-plugin/marketplace.json`);
  }
}
