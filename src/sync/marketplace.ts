import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { TEAM_PROFILES } from '../init/presets.js';
import { type Catalog, loadCatalogSync } from '../catalog/index.js';
import type { MarketplacePluginDefinition, TeamProfile } from '../types.js';

const VALID_PROFILE_IDS: ReadonlySet<string> = new Set(TEAM_PROFILES.map((p) => p.id));

/**
 * Build an id → profiles map from the catalog: every rule/agent/skill/guardrail id a pack ships
 * maps to that pack's profiles (universal packs → [] → included in every plugin). This is the
 * single source of truth for marketplace profile filtering. A file with no catalog entry (e.g. a
 * local project rule) falls back to [] (universal); a file's own `profiles:` frontmatter always wins.
 */
function buildProfileMap(catalog: Catalog): Map<string, TeamProfile[]> {
  const map = new Map<string, TeamProfile[]>();
  for (const pack of catalog.packs) {
    const profiles = pack.universal ? [] : pack.profiles;
    const ids = [
      ...(pack.rules ?? []),
      ...(pack.agents ?? []),
      ...(pack.skills ?? []),
      ...(pack.guardrails ?? []),
    ];
    for (const id of ids) map.set(id, profiles);
  }
  return map;
}

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
  rules: ManifestEntry[];
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

function resolveProfiles(
  id: string,
  frontmatterProfiles: TeamProfile[],
  profileMap: Map<string, TeamProfile[]>,
): TeamProfile[] {
  if (frontmatterProfiles.length > 0) return frontmatterProfiles;
  return profileMap.get(id) ?? [];
}

function readRuleMeta(ruleFile: string, sourceDir: string, profileMap: Map<string, TeamProfile[]>): FileMeta {
  const rulePath = join(sourceDir, ruleFile);
  const id = basename(ruleFile, '.md');
  try {
    const { data } = matter.read(rulePath);
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, (data.profiles as TeamProfile[]) || [], profileMap),
    };
  } catch {
    return { name: id, description: '', profiles: resolveProfiles(id, [], profileMap) };
  }
}

function readSkillMeta(
  skillDir: string,
  sourceParent: string,
  profileMap: Map<string, TeamProfile[]>,
): FileMeta {
  const skillPath = join(sourceParent, skillDir, 'SKILL.md');
  try {
    const { data } = matter.read(skillPath);
    return {
      name: (data.name as string) || skillDir,
      description: (data.description as string) || '',
      profiles: resolveProfiles(skillDir, (data.profiles as TeamProfile[]) || [], profileMap),
    };
  } catch {
    return { name: skillDir, description: '', profiles: resolveProfiles(skillDir, [], profileMap) };
  }
}

function readAgentMeta(
  agentFile: string,
  sourceDir: string,
  profileMap: Map<string, TeamProfile[]>,
): FileMeta {
  const agentPath = join(sourceDir, agentFile);
  const id = basename(agentFile, '.md');
  try {
    const { data } = matter.read(agentPath);
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, (data.profiles as TeamProfile[]) || [], profileMap),
    };
  } catch {
    return { name: id, description: '', profiles: resolveProfiles(id, [], profileMap) };
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
  allRules: Map<string, string>,
  allSkills: Map<string, string>,
  allAgents: Map<string, string>,
  hooksContent: string | null,
  recordError: (msg: string) => void,
  profileMap: Map<string, TeamProfile[]>,
): PluginManifest {
  const pluginDir = join(ctx.root, 'plugins', plugin.name);
  const rulesDir = join(pluginDir, 'rules');
  const skillsDir = join(pluginDir, 'skills');
  const agentsDir = join(pluginDir, 'agents');
  const manifestDir = join(pluginDir, '.claude-plugin');

  ensureDir(pluginDir);
  ensureDir(rulesDir);
  ensureDir(skillsDir);
  ensureDir(agentsDir);
  ensureDir(manifestDir);

  const ruleEntries: ManifestEntry[] = [];
  const skillEntries: ManifestEntry[] = [];
  const agentEntries: ManifestEntry[] = [];

  for (const [file, sourceDir] of allRules) {
    const meta = readRuleMeta(file, sourceDir, profileMap);
    if (!matchesPlugin(meta, plugin.profiles)) continue;

    const srcPath = join(sourceDir, file);
    const outPath = join(rulesDir, file);

    try {
      const content = readFileSync(srcPath, 'utf8');
      commitPlannedWrite(ctx, outPath, content);
      ruleEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/rules/${file}`,
      });
    } catch {
      recordError(`marketplace: could not read rule ${file}`);
    }
  }

  for (const [dirName, sourceParent] of allSkills) {
    const meta = readSkillMeta(dirName, sourceParent, profileMap);
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
    const meta = readAgentMeta(file, sourceDir, profileMap);
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
    rules: ruleEntries,
    skills: skillEntries,
    agents: agentEntries,
    ...(hooks !== undefined ? { hooks } : {}),
  };
}

export function syncMarketplace(ctx: MarketplaceSyncContext, recordError: (msg: string) => void): void {
  const allRules = mergeSourceFiles(ctx.sourceDirs, 'rules', (f) => f.endsWith('.md') && f !== 'README.md');
  const allSkills = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  const allAgents = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');

  if (allRules.size === 0 && allSkills.size === 0 && allAgents.size === 0) return;

  const profileMap = buildProfileMap(loadCatalogSync(ctx.root));
  const hooksContent = readHooksContent(ctx.sourceDirs);
  const projectName = basename(ctx.root);

  ctx.log(
    `Marketplace: ${ctx.plugins.length} plugin(s), ${allRules.size} rule(s), ${allSkills.size} skill(s), ${allAgents.size} agent(s)${hooksContent !== null ? ', hooks' : ''}`,
  );

  ensureDir(join(ctx.root, '.claude-plugin'));

  const pluginManifests: PluginManifest[] = [];

  for (const pluginDef of ctx.plugins) {
    const unknownProfiles = (pluginDef.profiles ?? []).filter((p) => !VALID_PROFILE_IDS.has(p));
    if (unknownProfiles.length > 0) {
      recordError(
        `Plugin "${pluginDef.name}" references unknown profile(s): ${unknownProfiles.join(', ')} — valid profiles are: ${[...VALID_PROFILE_IDS].sort().join(', ')}`,
      );
      continue;
    }

    const manifest = emitPlugin(
      ctx,
      pluginDef,
      allRules,
      allSkills,
      allAgents,
      hooksContent,
      recordError,
      profileMap,
    );

    const totalFiles = manifest.rules.length + manifest.skills.length + manifest.agents.length;
    if (totalFiles === 0) {
      const profileNames = (pluginDef.profiles ?? []).join(', ');
      const note = profileNames ? ` — no source files match profile(s): ${profileNames}` : '';
      recordError(`Plugin "${pluginDef.name}" resolved to 0 files${note}`);
      continue;
    }

    pluginManifests.push(manifest);

    const pluginJsonObj: Record<string, unknown> = {
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      rules: manifest.rules,
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
        `  -> plugins/${pluginDef.name}/ (${manifest.rules.length} rules, ${manifest.skills.length} skills, ${manifest.agents.length} agents${hooksNote})`,
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
