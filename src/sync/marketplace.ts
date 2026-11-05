import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { parseFrontmatter, readFrontmatter } from '../utils/frontmatter.js';
import { toClaudeAgentContent } from './claude-agent-tools.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { withGeneratedBanner } from './banner.js';
import {
  BundleFiles,
  COPILOT_EXTENSION_DIR,
  agentSkillIssue,
  isValidAgentPluginName,
  writeAgentPluginBundle,
} from './agent-plugins.js';
import { mergeSourceFiles, mergeSourceDirs } from './extends-loader.js';
import { skillDirsFor, type SkillOutput } from './targets.js';
import { TEAM_PROFILES } from '../init/presets.js';
import type { Catalog } from '../catalog/index.js';
import { AGENT_PLUGINS_PLATFORM, MARKETPLACE_PLATFORM } from '../types.js';
import type {
  BlueprintConfig,
  MarketplaceOwner,
  MarketplacePluginDefinition,
  PackageLock,
  Platform,
  Stack,
  StackConstraint,
  TeamProfile,
} from '../types.js';
import { buildStackMap, readFrontmatterStacks, resolveStacks, type StackMap } from '../stacks/resolve.js';
import { carriesDraftMarker } from '../drafts/marker.js';
import { buildPackItemMap, readSourcePackName, type PackItemMap } from '../catalog/ownership.js';
import {
  allowsPlatform,
  buildPlatformMap,
  resolvePlatformGate,
  type PlatformMap,
} from '../catalog/platforms.js';

const VALID_PROFILE_IDS: ReadonlySet<string> = new Set(TEAM_PROFILES.map((p) => p.id));

type ProfileMap = PackItemMap<TeamProfile[]>;

/**
 * Build a pack-scoped profiles map from the catalog: every rule/agent/skill/guardrail a pack ships
 * maps to that pack's profiles (universal packs → [] → included in every plugin). This is the
 * single source of truth for marketplace profile filtering. It only applies to files that come from
 * that pack's own source dir; any other file (e.g. a local project rule, even one whose id collides
 * with a pack item) falls back to [] (universal). A file's own `profiles:` frontmatter always wins.
 */
function buildProfileMap(catalog: Catalog): ProfileMap {
  return buildPackItemMap(catalog, (pack) => (pack.universal ? [] : pack.profiles));
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
  formats: PluginBundleFormats;
  /** `packages-lock.json`, for the pack entries each Agent Plugins bundle lock records. */
  packLock?: PackageLock;
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

export interface MarketplaceManifest {
  name: string;
  /** Required by Claude Code — a marketplace without `owner` is rejected at add time. */
  owner: MarketplaceOwner;
  plugins: Array<{ name: string; description: string; source: string }>;
}

interface FileMeta {
  name: string;
  description: string;
  /** Platforms the file is limited to (frontmatter > catalog); `null` = every platform. */
  platforms: string[] | null;
  /** Profiles this file belongs to. Empty = universal (included in all plugins). */
  profiles: TeamProfile[];
  /** Stack constraint (name → range). Empty = stack-agnostic (included in all plugins). */
  stacks: StackConstraint;
  /** Carries the `draft:` marker — never bundled (M7 create-loop). */
  draft?: boolean;
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
  kindDir: string,
  frontmatterProfiles: TeamProfile[] | undefined,
  profileMap: ProfileMap,
): TeamProfile[] {
  if (frontmatterProfiles !== undefined) return frontmatterProfiles;
  return profileMap.get(kindDir, id) ?? [];
}

/** Catalog maps a file's routing metadata falls back to when its frontmatter is silent. */
interface MetaMaps {
  profiles: ProfileMap;
  stacks: StackMap;
  platforms: PlatformMap;
}

function buildMetaMaps(catalog: Catalog): MetaMaps {
  return {
    profiles: buildProfileMap(catalog),
    stacks: buildStackMap(catalog),
    platforms: buildPlatformMap(catalog),
  };
}

function readRuleMeta(ruleFile: string, sourceDir: string, maps: MetaMaps): FileMeta {
  const rulePath = join(sourceDir, ruleFile);
  const id = basename(ruleFile, '.md');
  try {
    const { data } = readFrontmatter(rulePath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, sourceDir, readFrontmatterProfiles(record), maps.profiles),
      stacks: resolveStacks(id, sourceDir, readFrontmatterStacks(record), maps.stacks),
      platforms: resolvePlatformGate(id, sourceDir, record, maps.platforms).platforms,
      draft: carriesDraftMarker(record),
    };
  } catch {
    return {
      name: id,
      description: '',
      profiles: resolveProfiles(id, sourceDir, undefined, maps.profiles),
      stacks: resolveStacks(id, sourceDir, undefined, maps.stacks),
      platforms: resolvePlatformGate(id, sourceDir, {}, maps.platforms).platforms,
    };
  }
}

function readSkillMeta(skillDir: string, sourceParent: string, maps: MetaMaps): FileMeta {
  const skillPath = join(sourceParent, skillDir, 'SKILL.md');
  try {
    const { data } = readFrontmatter(skillPath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || skillDir,
      description: (data.description as string) || '',
      profiles: resolveProfiles(skillDir, sourceParent, readFrontmatterProfiles(record), maps.profiles),
      stacks: resolveStacks(skillDir, sourceParent, readFrontmatterStacks(record), maps.stacks),
      platforms: resolvePlatformGate(skillDir, sourceParent, record, maps.platforms).platforms,
      draft: carriesDraftMarker(record),
    };
  } catch {
    return {
      name: skillDir,
      description: '',
      profiles: resolveProfiles(skillDir, sourceParent, undefined, maps.profiles),
      stacks: resolveStacks(skillDir, sourceParent, undefined, maps.stacks),
      platforms: resolvePlatformGate(skillDir, sourceParent, {}, maps.platforms).platforms,
    };
  }
}

function readAgentMeta(agentFile: string, sourceDir: string, maps: MetaMaps): FileMeta {
  const agentPath = join(sourceDir, agentFile);
  const id = basename(agentFile, '.md');
  try {
    const { data } = readFrontmatter(agentPath);
    const record = data as Record<string, unknown>;
    return {
      name: (data.name as string) || id,
      description: (data.description as string) || '',
      profiles: resolveProfiles(id, sourceDir, readFrontmatterProfiles(record), maps.profiles),
      stacks: resolveStacks(id, sourceDir, readFrontmatterStacks(record), maps.stacks),
      platforms: resolvePlatformGate(id, sourceDir, record, maps.platforms).platforms,
      draft: carriesDraftMarker(record),
    };
  } catch {
    return {
      name: id,
      description: '',
      profiles: resolveProfiles(id, sourceDir, undefined, maps.profiles),
      stacks: resolveStacks(id, sourceDir, undefined, maps.stacks),
      platforms: resolvePlatformGate(id, sourceDir, {}, maps.platforms).platforms,
    };
  }
}

/** True when a file's PROFILE qualifies it for a plugin (universal = always). */
function profileMatches(fileMeta: FileMeta, pluginProfiles: TeamProfile[] | undefined): boolean {
  // Profile matching is the first test of every bundle decision, so an unvetted draft stops here.
  if (fileMeta.draft) return false;
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

/**
 * The formats of `plugin` a file is written in. Profile and stack must match; then each format has
 * its own platform gate (#281): Claude bundles take content allowed for `claude-marketplace` (which
 * includes `claude`), Agent Plugins bundles content allowed for `agent-plugins` — a list naming only
 * hosts such as `copilot` does not qualify, since one bundle reaches every host that installs it.
 */
function formatsForFile(
  fileMeta: FileMeta,
  plugin: MarketplacePluginDefinition,
  formats: PluginBundleFormats,
): PluginBundleFormats {
  if (!profileMatches(fileMeta, plugin.profiles) || !stackMatches(fileMeta, plugin.stacks)) {
    return { claude: false, agentPlugins: false };
  }
  return {
    claude: formats.claude && allowsPlatform(fileMeta.platforms, MARKETPLACE_PLATFORM),
    agentPlugins: formats.agentPlugins && allowsPlatform(fileMeta.platforms, AGENT_PLUGINS_PLATFORM),
  };
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
 * A YAML scalar for `value`: plain when it reads back unchanged, else double-quoted (JSON strings
 * are valid YAML). A plain `Guidance: x` or `- x` would not parse, and a host skips that skill.
 */
function yamlScalar(value: string): string {
  if (!value.includes('\n')) {
    try {
      if (parseFrontmatter(`---\nv: ${value}\n---\n`).data.v === value) return value;
    } catch {
      // Not a valid plain scalar: quote it.
    }
  }
  return JSON.stringify(value);
}

/**
 * Rewrites a rule file into a SKILL.md: strips the rule's own frontmatter (which may carry fields —
 * `profiles`, `scope` — that mean nothing to a skill loader) and replaces it with a minimal
 * `name`/`description` block, keeping the rule body verbatim.
 */
function ruleToSkillContent(name: string, meta: FileMeta, raw: string): string {
  const { content: body } = parseFrontmatter(raw);
  const description = meta.description || `Guidance: ${meta.name}`;
  return `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description)}\n---\n${body}`;
}

/** Which bundle formats this pass writes into each `plugins/<name>/` directory. */
export interface PluginBundleFormats {
  /** `.claude-plugin/plugin.json`, `agents/`, `hooks/` (the `claude-marketplace` platform). */
  claude: boolean;
  /** Root `plugin.json`, `com.github.copilot/agents/`, bundle lock (the `agent-plugins` platform). */
  agentPlugins: boolean;
}

interface EmittedPlugin {
  manifest: PluginManifest;
  files: BundleFiles;
  /** npm names of the packs that contributed content (for the Agent Plugins bundle lock). */
  packNames: Set<string>;
  /** Agents written in each format: Claude's are in `manifest.agents`, Copilot's only counted. */
  agentCount: number;
}

interface PluginSources {
  rules: Map<string, string>;
  skills: Map<string, string>;
  agents: Map<string, string>;
  hooksContent: string | null;
  maps: MetaMaps;
}

function addOwner(packNames: Set<string>, kindDir: string): void {
  const owner = readSourcePackName(dirname(kindDir));
  if (owner !== undefined) packNames.add(owner);
}

/** Reports a bundle skill a conformant Agent Plugins host would skip, once per skill per sync. */
type SkillCheck = (skillDir: string, content: string) => void;

function emitPlugin(
  ctx: MarketplaceSyncContext,
  plugin: MarketplacePluginDefinition,
  formats: PluginBundleFormats,
  sources: PluginSources,
  recordError: (msg: string) => void,
  checkSkill: SkillCheck,
): EmittedPlugin {
  const { maps } = sources;
  const files = new BundleFiles(ctx, join(ctx.root, 'plugins', plugin.name));
  const packNames = new Set<string>();
  const skillEntries: ManifestEntry[] = [];
  const agentEntries: ManifestEntry[] = [];
  let agentCount = 0;

  for (const [file, sourceDir] of sources.rules) {
    const meta = readRuleMeta(file, sourceDir, maps);
    if (!bundleTakesSkill(meta, plugin, formats)) continue;

    const skillId = ruleToSkillId(file);
    try {
      const raw = readFileSync(join(sourceDir, file), 'utf8');
      // The Agent Skills spec requires `name` to match the directory; Claude-only output keeps the
      // rule's own name, as it always has.
      const content = ruleToSkillContent(formats.agentPlugins ? skillId : meta.name, meta, raw);
      if (formats.agentPlugins) checkSkill(skillId, content);
      files.write(`skills/${skillId}/SKILL.md`, withGeneratedBanner(content, `rules/${file}`));
      addOwner(packNames, sourceDir);
      skillEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/skills/${skillId}/SKILL.md`,
      });
    } catch {
      recordError(`marketplace: could not read rule ${file}`);
    }
  }

  for (const [dirName, sourceParent] of sources.skills) {
    const meta = readSkillMeta(dirName, sourceParent, maps);
    if (!bundleTakesSkill(meta, plugin, formats)) continue;

    try {
      const source = readFileSync(join(sourceParent, dirName, 'SKILL.md'), 'utf8');
      if (formats.agentPlugins) checkSkill(dirName, source);
      files.write(`skills/${dirName}/SKILL.md`, withGeneratedBanner(source, `skills/${dirName}/SKILL.md`));
      files.copySkillFiles(join(sourceParent, dirName), `skills/${dirName}`);
      addOwner(packNames, sourceParent);
      skillEntries.push({
        name: meta.name,
        description: meta.description,
        path: `plugins/${plugin.name}/skills/${dirName}/SKILL.md`,
      });
    } catch {
      recordError(`marketplace: could not read skill ${dirName}`);
    }
  }

  for (const [file, sourceDir] of sources.agents) {
    const meta = readAgentMeta(file, sourceDir, maps);
    // Agents have a dir per format, so each format's platform gate applies on its own.
    const on = formatsForFile(meta, plugin, formats);
    if (!hasAnyFormat(on)) continue;

    try {
      const source = readFileSync(join(sourceDir, file), 'utf8');
      if (on.claude) {
        files.write(`agents/${file}`, withGeneratedBanner(toClaudeAgentContent(source), `agents/${file}`));
        agentEntries.push({
          name: meta.name,
          description: meta.description,
          path: `plugins/${plugin.name}/agents/${file}`,
        });
      }
      if (on.agentPlugins) {
        // Copilot's agent profile format is the source as-is, under the `.agent.md` extension.
        const outName = file.replace(/\.md$/, '.agent.md');
        files.write(
          `${COPILOT_EXTENSION_DIR}/agents/${outName}`,
          withGeneratedBanner(source, `agents/${file}`),
        );
      }
      addOwner(packNames, sourceDir);
      agentCount++;
    } catch {
      recordError(`marketplace: could not read agent ${file}`);
    }
  }

  // Claude Code hooks have no Agent Plugins equivalent (spec v1 has no hooks component).
  let hooks: string | undefined;
  if (formats.claude && sources.hooksContent !== null) {
    files.write('hooks/hooks.json', sources.hooksContent);
    hooks = `plugins/${plugin.name}/hooks/hooks.json`;
  }

  return {
    manifest: {
      name: plugin.name,
      displayName: plugin.displayName ?? plugin.name,
      description: plugin.description ?? '',
      skills: skillEntries,
      agents: agentEntries,
      ...(hooks !== undefined ? { hooks } : {}),
    },
    files,
    packNames,
    agentCount,
  };
}

function writeClaudePluginManifest(ctx: MarketplaceSyncContext, manifest: PluginManifest): void {
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
    join(ctx.root, 'plugins', manifest.name, '.claude-plugin', 'plugin.json'),
    JSON.stringify(pluginJsonObj, null, 2),
  );
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

export interface PluginFormatPlan {
  /** The formats this plugin is written in; none when the definition itself is invalid. */
  formats: PluginBundleFormats;
  /** Why a format was dropped, or why the plugin is skipped. */
  issue?: string;
}

/**
 * The formats one plugin definition is written in. An unknown profile skips the plugin. A name that
 * isn't a valid Agent Plugins name drops only the Agent Plugins files, so turning `agent-plugins` on
 * never takes a plugin out of an existing Claude marketplace. Sync, `why` and `preview` share this.
 */
export function planPluginFormats(
  pluginDef: MarketplacePluginDefinition,
  formats: PluginBundleFormats,
): PluginFormatPlan {
  const unknownProfiles = (pluginDef.profiles ?? []).filter((p) => !VALID_PROFILE_IDS.has(p));
  if (unknownProfiles.length > 0) {
    return {
      formats: { claude: false, agentPlugins: false },
      issue: `Plugin "${pluginDef.name}" references unknown profile(s): ${unknownProfiles.join(', ')} — valid profiles are: ${[...VALID_PROFILE_IDS].sort().join(', ')}`,
    };
  }
  if (formats.agentPlugins && !isValidAgentPluginName(pluginDef.name)) {
    const skipped = formats.claude ? 'its Agent Plugins files are skipped' : 'it is skipped';
    return {
      formats: { claude: formats.claude, agentPlugins: false },
      issue: `Plugin "${pluginDef.name}" is not a valid Agent Plugins name, so ${skipped} — set marketplace.plugins[].name to 1-64 lowercase letters, digits, "-" or "." with a letter or digit at each end and no "--" or ".." (e.g. "${toPluginName(pluginDef.name)}")`,
    };
  }
  return { formats };
}

/**
 * Whether a skill (or rule skill) goes into the bundle's `skills/`. That dir is one output every host
 * of the bundle reads, so this is #351's shared-output rule (`skillDirsFor`): it takes the skill when
 * one of its readers — the bundle platforms this plugin is written for — is allowed.
 */
function bundleTakesSkill(
  fileMeta: FileMeta,
  plugin: MarketplacePluginDefinition,
  formats: PluginBundleFormats,
): boolean {
  if (!profileMatches(fileMeta, plugin.profiles) || !stackMatches(fileMeta, plugin.stacks)) return false;
  const readers: Platform[] = [];
  if (formats.claude) readers.push(MARKETPLACE_PLATFORM);
  if (formats.agentPlugins) readers.push(AGENT_PLUGINS_PLATFORM);
  const bundleSkills: SkillOutput = { target: { dir: 'skills' }, platforms: readers, covered: [] };
  return skillDirsFor([bundleSkills], fileMeta.platforms).length > 0;
}

function hasAnyFormat(formats: PluginBundleFormats): boolean {
  return formats.claude || formats.agentPlugins;
}

function bundleNote(emitted: EmittedPlugin): string {
  const { manifest } = emitted;
  const hooksNote = manifest.hooks !== undefined ? ', hooks' : '';
  return `${manifest.skills.length} skills, ${emitted.agentCount} agents${hooksNote}`;
}

/**
 * Emits one bundle per plugin definition under `plugins/<name>/`, in each format `ctx.formats`
 * turns on, and the `.claude-plugin/marketplace.json` index that lists them. That index is the one
 * marketplace file Claude Code, Copilot CLI, VS Code and Codex all read; the Agent Plugins spec
 * leaves distribution out of scope. Returns the index, or `null` when there is no source content.
 */
export function syncPluginBundles(
  ctx: MarketplaceSyncContext,
  recordError: (msg: string) => void,
  recordWarning: (msg: string) => void,
): MarketplaceManifest | null {
  const rules = mergeSourceFiles(ctx.sourceDirs, 'rules', (f) => f.endsWith('.md') && f !== 'README.md');
  const skills = mergeSourceDirs(ctx.sourceDirs, 'skills', (dirPath) =>
    existsSync(join(dirPath, 'SKILL.md')),
  );
  const agents = mergeSourceFiles(ctx.sourceDirs, 'agents', (f) => f.endsWith('.md') && f !== 'README.md');

  if (rules.size === 0 && skills.size === 0 && agents.size === 0) return null;

  const sources: PluginSources = {
    rules,
    skills,
    agents,
    hooksContent: readHooksContent(ctx.sourceDirs),
    maps: buildMetaMaps(ctx.catalog),
  };
  const projectName = basename(ctx.root);

  const formatNames = [ctx.formats.claude ? 'Claude' : '', ctx.formats.agentPlugins ? 'Agent Plugins' : '']
    .filter(Boolean)
    .join(' + ');
  ctx.log(
    `Plugin bundles (${formatNames}): ${ctx.plugins.length} plugin(s), ${rules.size} rule(s), ${skills.size} skill(s), ${agents.size} agent(s)${sources.hooksContent !== null && ctx.formats.claude ? ', hooks' : ''}`,
  );

  const pluginManifests: PluginManifest[] = [];

  const checkedSkills = new Set<string>();
  const checkSkill: SkillCheck = (skillDir, content) => {
    if (checkedSkills.has(skillDir)) return;
    checkedSkills.add(skillDir);
    const issue = agentSkillIssue(skillDir, content);
    if (issue !== null) {
      recordWarning(
        `agent-plugins: skill "${skillDir}" does not conform to the Agent Skills spec (${issue}); hosts will skip it`,
      );
    }
  };

  for (const pluginDef of ctx.plugins) {
    const plan = planPluginFormats(pluginDef, ctx.formats);
    if (plan.issue !== undefined) (hasAnyFormat(plan.formats) ? recordWarning : recordError)(plan.issue);
    if (!hasAnyFormat(plan.formats)) continue;
    const { formats } = plan;

    const emitted = emitPlugin(ctx, pluginDef, formats, sources, recordError, checkSkill);
    const { manifest } = emitted;

    if (manifest.skills.length + emitted.agentCount === 0) {
      const profileNames = (pluginDef.profiles ?? []).join(', ');
      const note = profileNames ? ` — no source files match profile(s): ${profileNames}` : '';
      recordError(`Plugin "${pluginDef.name}" resolved to 0 files${note}`);
      continue;
    }

    pluginManifests.push(manifest);
    if (formats.claude) writeClaudePluginManifest(ctx, manifest);
    if (formats.agentPlugins) {
      writeAgentPluginBundle(
        emitted.files,
        {
          name: pluginDef.name,
          description: pluginDef.description,
          owner: resolveOwner(ctx, projectName),
          remote: ctx.remote,
          profiles: pluginDef.profiles,
          stacks: pluginDef.stacks,
          packNames: emitted.packNames,
        },
        ctx.packLock,
        recordWarning,
      );
    }

    if (!ctx.checkMode) ctx.log(`  -> plugins/${pluginDef.name}/ (${bundleNote(emitted)})`);
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
  return marketplace;
}

/** One generated bundle path for a source item (`why`), relative to the project root. */
export interface BundleOutput {
  platform: typeof MARKETPLACE_PLATFORM | typeof AGENT_PLUGINS_PLATFORM;
  path: string;
}

/**
 * The plugin definitions sync bundles for a config: `marketplace.plugins`, or one plugin named after
 * the project holding everything.
 */
export function pluginDefinitionsFor(config: BlueprintConfig, root: string): MarketplacePluginDefinition[] {
  const projectName = basename(root);
  return config.marketplace?.plugins ?? [{ name: projectName, displayName: projectName, description: '' }];
}

/**
 * A valid Agent Plugins name close to `dirName`, suggested when a plugin's name isn't one. Never
 * applied on its own: renaming a plugin moves its directory and its `enabledPlugins` key.
 */
export function toPluginName(dirName: string): string {
  const name = dirName
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .slice(0, 64)
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return name || 'plugin';
}

/**
 * Bundle paths a rule, skill or agent is written to, by the same profile and stack matching sync
 * uses. Bundles are gated by name only (the consuming project's versions are unknown when they are
 * built), so this holds whether or not the project's own stack gate includes the item.
 */
export function createBundleOutputResolver(
  config: BlueprintConfig,
  platforms: readonly Platform[],
  root: string,
  catalog: Catalog,
): (kind: 'rules' | 'skills' | 'agents', key: string, kindDir: string) => BundleOutput[] {
  const claude = platforms.includes(MARKETPLACE_PLATFORM);
  const agentPlugins = platforms.includes(AGENT_PLUGINS_PLATFORM);
  if (!claude && !agentPlugins) return () => [];

  const plugins = pluginDefinitionsFor(config, root);
  const maps = buildMetaMaps(catalog);

  return (kind, key, kindDir) => {
    const meta =
      kind === 'rules'
        ? readRuleMeta(key, kindDir, maps)
        : kind === 'skills'
          ? readSkillMeta(key, kindDir, maps)
          : readAgentMeta(key, kindDir, maps);
    const out: BundleOutput[] = [];
    for (const plugin of plugins) {
      const planned = planPluginFormats(plugin, { claude, agentPlugins }).formats;
      const on = formatsForFile(meta, plugin, planned);
      const base = `plugins/${plugin.name}`;
      if (kind !== 'agents') {
        if (!bundleTakesSkill(meta, plugin, planned)) continue;
        const skillDir = kind === 'rules' ? ruleToSkillId(key) : key;
        if (on.claude)
          out.push({ platform: MARKETPLACE_PLATFORM, path: `${base}/skills/${skillDir}/SKILL.md` });
        if (on.agentPlugins)
          out.push({ platform: AGENT_PLUGINS_PLATFORM, path: `${base}/skills/${skillDir}/SKILL.md` });
        continue;
      }
      if (!hasAnyFormat(on)) continue;
      if (on.claude) out.push({ platform: MARKETPLACE_PLATFORM, path: `${base}/agents/${key}` });
      if (on.agentPlugins) {
        const copilotName = key.replace(/\.md$/, '.agent.md');
        out.push({
          platform: AGENT_PLUGINS_PLATFORM,
          path: `${base}/${COPILOT_EXTENSION_DIR}/agents/${copilotName}`,
        });
      }
    }
    return out;
  };
}
