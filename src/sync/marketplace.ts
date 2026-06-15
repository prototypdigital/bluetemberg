import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { ensureDir } from '../utils/fs.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { TEAM_PROFILES } from '../init/presets.js';
import { type Catalog, loadCatalogSync } from '../catalog/index.js';
import type { MarketplacePluginDefinition, Stack, StackConstraint, TeamProfile } from '../types.js';
import { isValidStackRange } from '../stacks/match.js';

const VALID_PROFILE_IDS: ReadonlySet<string> = new Set(TEAM_PROFILES.map((p) => p.id));

/**
 * Build an id → stack-constraint map from the catalog. Pack-level `stacks` are coarse, name-only
 * (`["payload"]`), so each maps to a wildcard range (`{ payload: "*" }`). A rule's own
 * `stacks:` frontmatter (with version ranges) overrides this. Files with no stacks anywhere are
 * stack-agnostic and belong in every bundle.
 */
function buildStackMap(catalog: Catalog): Map<string, StackConstraint> {
  const map = new Map<string, StackConstraint>();
  for (const pack of catalog.packs) {
    const stacks = pack.stacks ?? [];
    if (stacks.length === 0) continue;
    const constraint: StackConstraint = {};
    for (const s of stacks) constraint[s] = '*';
    const ids = [
      ...(pack.rules ?? []),
      ...(pack.agents ?? []),
      ...(pack.skills ?? []),
      ...(pack.guardrails ?? []),
    ];
    for (const id of ids) map.set(id, constraint);
  }
  return map;
}

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
  /** Stack constraint (name → range). Empty = stack-agnostic (included in all plugins). */
  stacks: StackConstraint;
}

/**
 * Returns the validated profiles array when the `profiles` key is present in frontmatter,
 * or `undefined` when the key is absent entirely. This lets `resolveProfiles` distinguish
 * "explicit empty override" (`profiles: []` → universal) from "no frontmatter" (fall back
 * to the catalog map).
 */
function readFrontmatterProfiles(data: Record<string, unknown>): TeamProfile[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, 'profiles')) return undefined;
  const value = data.profiles;
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is TeamProfile => typeof p === 'string' && VALID_PROFILE_IDS.has(p));
}

function resolveProfiles(
  id: string,
  frontmatterProfiles: TeamProfile[] | undefined,
  profileMap: Map<string, TeamProfile[]>,
): TeamProfile[] {
  if (frontmatterProfiles !== undefined) return frontmatterProfiles;
  return profileMap.get(id) ?? [];
}

/**
 * Returns the validated stack constraint when the `stacks` key is present in frontmatter, or
 * `undefined` when absent (fall back to the catalog map). Invalid ranges are dropped so a
 * malformed range never silently matches. Mirrors `readFrontmatterProfiles`.
 */
function readFrontmatterStacks(data: Record<string, unknown>): StackConstraint | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, 'stacks')) return undefined;
  const value = data.stacks;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: StackConstraint = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof name !== 'string' || typeof range !== 'string') continue;
    if (!isValidStackRange(range)) continue;
    out[name] = range;
  }
  return out;
}

function resolveStacks(
  id: string,
  frontmatterStacks: StackConstraint | undefined,
  stackMap: Map<string, StackConstraint>,
): StackConstraint {
  if (frontmatterStacks !== undefined) return frontmatterStacks;
  return stackMap.get(id) ?? {};
}

function readRuleMeta(
  ruleFile: string,
  sourceDir: string,
  profileMap: Map<string, TeamProfile[]>,
  stackMap: Map<string, StackConstraint>,
): FileMeta {
  const rulePath = join(sourceDir, ruleFile);
  const id = basename(ruleFile, '.md');
  try {
    const { data } = matter.read(rulePath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, readFrontmatterProfiles(record), profileMap),
      stacks: resolveStacks(id, readFrontmatterStacks(record), stackMap),
    };
  } catch {
    return {
      name: id,
      description: '',
      profiles: resolveProfiles(id, undefined, profileMap),
      stacks: resolveStacks(id, undefined, stackMap),
    };
  }
}

function readSkillMeta(
  skillDir: string,
  sourceParent: string,
  profileMap: Map<string, TeamProfile[]>,
  stackMap: Map<string, StackConstraint>,
): FileMeta {
  const skillPath = join(sourceParent, skillDir, 'SKILL.md');
  try {
    const { data } = matter.read(skillPath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || skillDir,
      description: (data.description as string) || '',
      profiles: resolveProfiles(skillDir, readFrontmatterProfiles(record), profileMap),
      stacks: resolveStacks(skillDir, readFrontmatterStacks(record), stackMap),
    };
  } catch {
    return {
      name: skillDir,
      description: '',
      profiles: resolveProfiles(skillDir, undefined, profileMap),
      stacks: resolveStacks(skillDir, undefined, stackMap),
    };
  }
}

function readAgentMeta(
  agentFile: string,
  sourceDir: string,
  profileMap: Map<string, TeamProfile[]>,
  stackMap: Map<string, StackConstraint>,
): FileMeta {
  const agentPath = join(sourceDir, agentFile);
  const id = basename(agentFile, '.md');
  try {
    const { data } = matter.read(agentPath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, readFrontmatterProfiles(record), profileMap),
      stacks: resolveStacks(id, readFrontmatterStacks(record), stackMap),
    };
  } catch {
    return {
      name: id,
      description: '',
      profiles: resolveProfiles(id, undefined, profileMap),
      stacks: resolveStacks(id, undefined, stackMap),
    };
  }
}

/** True when a file's PROFILE qualifies it for a plugin (universal = always). */
function profileMatches(fileMeta: FileMeta, pluginProfiles: TeamProfile[] | undefined): boolean {
  if (!pluginProfiles || pluginProfiles.length === 0) return true;
  if (fileMeta.profiles.length === 0) return true;
  return fileMeta.profiles.some((p) => pluginProfiles.includes(p));
}

/**
 * True when a file's STACK qualifies it for a plugin (the second, ANDed dimension that fixes the
 * leak). Stack-agnostic files (no `stacks:`) belong in every bundle; stack-specific files belong
 * ONLY in a bundle that opts into at least one of their stacks. Marketplace gating is name-level
 * (the consuming project's version is unknown at build time); version ranges gate at project sync.
 */
function stackMatches(fileMeta: FileMeta, pluginStacks: Stack[] | undefined): boolean {
  const fileStacks = Object.keys(fileMeta.stacks);
  if (fileStacks.length === 0) return true;
  const opted = pluginStacks ?? [];
  return fileStacks.some((s) => opted.includes(s));
}

/** A file is included in a plugin only when BOTH its profile and its stack qualify. */
function matchesPlugin(fileMeta: FileMeta, plugin: MarketplacePluginDefinition): boolean {
  return profileMatches(fileMeta, plugin.profiles) && stackMatches(fileMeta, plugin.stacks);
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
  stackMap: Map<string, StackConstraint>,
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
    const meta = readRuleMeta(file, sourceDir, profileMap, stackMap);
    if (!matchesPlugin(meta, plugin)) continue;

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
    const meta = readSkillMeta(dirName, sourceParent, profileMap, stackMap);
    if (!matchesPlugin(meta, plugin)) continue;

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
    const meta = readAgentMeta(file, sourceDir, profileMap, stackMap);
    if (!matchesPlugin(meta, plugin)) continue;

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

  const catalog = loadCatalogSync(ctx.root);
  const profileMap = buildProfileMap(catalog);
  const stackMap = buildStackMap(catalog);
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
      stackMap,
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
