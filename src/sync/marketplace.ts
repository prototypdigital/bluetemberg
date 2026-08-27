import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { commitPlannedWrite, ensurePlannedDir, type SyncSink } from './pipeline.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { TEAM_PROFILES } from '../init/presets.js';
import type { Catalog } from '../catalog/index.js';
import type {
  MarketplaceOwner,
  MarketplacePluginDefinition,
  Stack,
  StackConstraint,
  TeamProfile,
} from '../types.js';
import { buildStackMap, readFrontmatterStacks, resolveStacks } from '../stacks/resolve.js';

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
  /** Catalog loaded once per sync (shared with rule/guardrail version gating). */
  catalog: Catalog;
  /** `marketplace.owner` from config; when absent the emitter derives a fallback. */
  owner?: MarketplaceOwner;
  /** `marketplace.remote` from config (`owner/repo`); its owner segment is the fallback owner. */
  remote?: string;
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
  /**
   * Rule content is emitted as skills (see `ruleToSkillId`/`ruleToSkillContent`) — Claude Code's
   * plugin schema has no standalone "rules" component, and a bare CLAUDE.md at the plugin root is
   * not loaded as context. Skills are the only component type that loads markdown guidance into
   * the model's context, so a rule becomes a skill named `rule-{id}` to avoid colliding with an
   * actual skill that happens to share the same id.
   */
  skills: ManifestEntry[];
  agents: ManifestEntry[];
  /** Relative path to `hooks/hooks.json` within the plugin dir. Present only when hooks are defined. */
  hooks?: string;
}

interface MarketplaceManifest {
  name: string;
  /** Required by Claude Code — a marketplace without `owner` is rejected at add time. */
  owner: MarketplaceOwner;
  plugins: Array<{ name: string; description: string; source: string }>;
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

/**
 * `rule-` prefix keeps a rule's generated skill from colliding with an actual skill directory
 * that happens to share the same basename (e.g. a `patterns` rule and a `patterns` skill).
 */
function ruleToSkillId(ruleFile: string): string {
  return `rule-${basename(ruleFile, '.md')}`;
}

/**
 * Rewrites a rule file into a valid SKILL.md: strips the rule's own frontmatter (which may carry
 * fields — `profiles`, `scope` — that mean nothing to Claude Code's skill loader) and replaces it
 * with a minimal `name`/`description` block, keeping the rule body verbatim.
 */
function ruleToSkillContent(meta: FileMeta, raw: string): string {
  const { content: body } = matter(raw);
  const description = meta.description || `Guidance: ${meta.name}`;
  return `---\nname: ${meta.name}\ndescription: ${description}\n---\n${body}`;
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
  const skillsDir = join(pluginDir, 'skills');
  const agentsDir = join(pluginDir, 'agents');
  const manifestDir = join(pluginDir, '.claude-plugin');

  ensurePlannedDir(ctx, pluginDir);
  ensurePlannedDir(ctx, skillsDir);
  ensurePlannedDir(ctx, agentsDir);
  ensurePlannedDir(ctx, manifestDir);

  const skillEntries: ManifestEntry[] = [];
  const agentEntries: ManifestEntry[] = [];

  for (const [file, sourceDir] of allRules) {
    const meta = readRuleMeta(file, sourceDir, profileMap, stackMap);
    if (!matchesPlugin(meta, plugin)) continue;

    const srcPath = join(sourceDir, file);
    const skillId = ruleToSkillId(file);
    const outSkillDir = join(skillsDir, skillId);

    try {
      const raw = readFileSync(srcPath, 'utf8');
      commitPlannedWrite(ctx, join(outSkillDir, 'SKILL.md'), ruleToSkillContent(meta, raw));
      skillEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/skills/${skillId}/SKILL.md`,
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
    ensurePlannedDir(ctx, outSkillDir);

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
    ensurePlannedDir(ctx, hooksDir);
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

/**
 * Claude Code rejects a marketplace whose manifest lacks `owner`. Precedence: explicit
 * `marketplace.owner` config, then the owner segment of `marketplace.remote` (`owner/repo`),
 * then the project directory name as a last resort.
 */
function resolveOwner(ctx: MarketplaceSyncContext, projectName: string): MarketplaceOwner {
  if (ctx.owner?.name) return ctx.owner;
  const remoteOwner = ctx.remote?.split('/')[0]?.trim();
  if (remoteOwner) return { name: remoteOwner };
  return { name: projectName };
}

export function syncMarketplace(ctx: MarketplaceSyncContext, recordError: (msg: string) => void): void {
  const allRules = mergeSourceFiles(ctx.sourceDirs, 'rules', (f) => f.endsWith('.md') && f !== 'README.md');
  const allSkills = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  const allAgents = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');

  if (allRules.size === 0 && allSkills.size === 0 && allAgents.size === 0) return;

  const profileMap = buildProfileMap(ctx.catalog);
  const stackMap = buildStackMap(ctx.catalog);
  const hooksContent = readHooksContent(ctx.sourceDirs);
  const projectName = basename(ctx.root);

  ctx.log(
    `Marketplace: ${ctx.plugins.length} plugin(s), ${allRules.size} rule(s), ${allSkills.size} skill(s), ${allAgents.size} agent(s)${hooksContent !== null ? ', hooks' : ''}`,
  );

  ensurePlannedDir(ctx, join(ctx.root, '.claude-plugin'));

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

    const totalFiles = manifest.skills.length + manifest.agents.length;
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
    owner: resolveOwner(ctx, projectName),
    plugins: pluginManifests.map((p) => ({
      name: p.name,
      description: p.description,
      source: `./plugins/${p.name}`,
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
