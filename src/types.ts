export type Platform = 'cursor' | 'claude' | 'copilot' | 'gemini' | 'claude-marketplace';
export const MARKETPLACE_PLATFORM = 'claude-marketplace' satisfies Platform;

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export type TeamProfile = 'frontend' | 'backend' | 'fullstack' | 'devops' | 'pure-infra' | 'custom';

export interface TargetConfig {
  dir: string;
  ext: string;
}

export interface SkillTargetConfig {
  dir: string;
}

export interface MarketplacePluginDefinition {
  /** Plugin identifier, used as directory name under `plugins/`. */
  name: string;
  /** Human-readable display name shown in Claude Desktop. */
  displayName?: string;
  /** Short description shown in Claude Desktop. */
  description?: string;
  /**
   * Team profiles this plugin targets. When set, only llm/ files tagged with a matching
   * profile are included. When omitted, all llm/ content is included.
   */
  profiles?: TeamProfile[];
}

export interface MarketplaceConfig {
  /**
   * Plugin definitions. Each entry becomes one installable plugin in the marketplace.
   * When omitted, bluetemberg emits a single plugin named after the project containing
   * all llm/ skills and agents.
   */
  plugins?: MarketplacePluginDefinition[];
}

export interface BlueprintConfig {
  platforms: Platform[];
  source: string;
  targets: {
    rules?: Partial<Record<Platform, TargetConfig>>;
    agents?: Partial<Record<Platform, TargetConfig>>;
    skills?: Partial<Record<Platform, SkillTargetConfig>>;
  };
  /**
   * Marketplace plugin definitions. Only used when `claude-marketplace` is in `platforms`.
   * Controls how llm/ content maps to installable plugins.
   */
  marketplace?: MarketplaceConfig;
  /**
   * Additional source directories to merge with the local `source` directory.
   * Supports relative paths (e.g. `"../../"` for monorepo root) and npm package names
   * (e.g. `"@company/ai-rules"`). The local `source` directory always takes highest priority;
   * earlier entries in the array take priority over later ones.
   *
   * For relative paths, Bluetemberg looks for a `llm/` subdirectory at that path, then falls
   * back to the path itself. For npm packages, it looks inside `node_modules/{name}/llm/`.
   */
  extends?: string | string[];
  /**
   * Optional ESM module specifiers (npm package names or `file:` URLs) loaded after built-in sync steps.
   * Each module must `export default` as a function or `{ run(ctx, recordError) }` — see wiki *Adapters*.
   */
  adapters?: string[];
}

export type RuleSource = 'templates' | 'collections';

export interface RuleCollectionPreset {
  id: string;
  name: string;
  packageName: string;
  description: string;
  rules: string[];
  tags?: TeamProfile[];
}

export interface InitAnswers {
  teamProfile: TeamProfile;
  projectName: string;
  projectDescription: string;
  packageManager: PackageManager;
  platforms: Platform[];
  ruleSource: RuleSource;
  rules: string[];
  ruleCollections: string[];
  includeAgents: boolean;
  agents: string[];
  includeSkills: boolean;
  skills: string[];
  includeMcp: boolean;
  mcpServers: string[];
}

/** Options for `init()` besides the target directory (CLI parity). */
export interface InitRunOptions {
  /** Read full answers from `--config` JSON. */
  configPath?: string;
  /** Use profile baseline + optional `nonInteractiveOverrides` instead of prompts. */
  nonInteractive?: boolean;
  /** Team profile for non-interactive mode (default `fullstack`). Ignored when `configPath` is set. */
  profile?: TeamProfile;
  /** Merged onto `buildInitAnswersFromProfile` when `nonInteractive` is true (ignored when `configPath`). */
  nonInteractiveOverrides?: Partial<InitAnswers>;
  /** Bypass prompt/config resolution (embedded callers). */
  answers?: InitAnswers;
  /** When true, omit progress and success output; forwarded to initial `sync()` as well. */
  silent?: boolean;
}

export interface SyncOptions {
  check?: boolean;
  config?: BlueprintConfig;
  silent?: boolean;
  /**
   * After a successful write pass, delete previously generated files under managed output dirs
   * that are not part of the current plan. Ignored in check mode. See wiki *Commands*.
   */
  prune?: boolean;
  /**
   * Emit additional debug output: resolved source directories, per-file origin when multiple
   * sources are active, and any non-fatal warnings (e.g. unresolved `extends` entries).
   */
  verbose?: boolean;
}

export interface SyncResults {
  synced: number;
  outOfSync: number;
  /** Fatal issues that caused sync to partially fail. Causes exit code 1. */
  errors: string[];
  /** Non-fatal notices — logged but do not affect exit code. */
  warnings: string[];
}

export interface RuleFrontmatter {
  description?: string;
  scope?: string | string[];
}

export interface PresetItem {
  id: string;
  name: string;
  description: string;
  default: boolean;
  tags?: TeamProfile[];
  universal?: boolean;
  /** Profiles for which this rule is NOT forced even when universal is true. */
  universalExcludeProfiles?: TeamProfile[];
}

export interface PlatformChoice {
  id: Platform;
  name: string;
}

export interface PackageManagerChoice {
  id: PackageManager;
  name: string;
}

export interface TeamProfileChoice {
  id: TeamProfile;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Registry — community rule packs
// ---------------------------------------------------------------------------

/** Manifest file (`llm/rule-packages.json`) — committed to version control. */
export interface PackageManifest {
  /** Optional custom registry URL. Defaults to `https://registry.npmjs.org`. */
  registry?: string;
  /** Map of package name → semver range (e.g. `"^1.2.0"`). */
  packages: Record<string, string>;
}

/** Single entry in the lockfile. */
export interface PackageLockEntry {
  /** Exact resolved version (e.g. `"1.2.3"`). */
  version: string;
  /** Full tarball URL used to download this version. */
  resolved: string;
  /** Subresource integrity hash (`sha512-…`). */
  integrity: string;
}

/** Lockfile (`llm/rule-packages-lock.json`) — committed to version control. */
export interface PackageLock {
  lockfileVersion: 1;
  packages: Record<string, PackageLockEntry>;
}

/** Metadata returned from the npm registry for a single package. */
export interface NpmPackageMetadata {
  name: string;
  description?: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, NpmVersionMetadata>;
}

/** Metadata for a specific version from the npm registry. */
export interface NpmVersionMetadata {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  dist: {
    tarball: string;
    integrity?: string;
    shasum: string;
  };
}

/** npm search result item. */
export interface NpmSearchResult {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
}

/** Describes a locally installed rule pack. */
export interface InstalledPackage {
  name: string;
  /** Semver range from the manifest. */
  range: string;
  /** Exact installed version from the lockfile. */
  version: string;
  /** Absolute path to the extracted pack content. */
  path: string;
}

/** Options for `registry.add()`. */
export interface RegistryAddOptions {
  /** Semver range (default: `"latest"`). */
  version?: string;
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.install()`. */
export interface RegistryInstallOptions {
  /** Suppress output. */
  silent?: boolean;
  /** Force re-download even if cached. */
  force?: boolean;
}

/** Options for `registry.search()`. */
export interface RegistrySearchOptions {
  /** Max results to return (default: 20). */
  limit?: number;
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.remove()`. */
export interface RegistryRemoveOptions {
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.list()`. */
export interface RegistryListOptions {
  /** Suppress output. */
  silent?: boolean;
}

/** Options for `registry.update()`. */
export interface RegistryUpdateOptions {
  /** Suppress output. */
  silent?: boolean;
  /** Widen each package's range to "latest" in the manifest, not just re-resolve the current range. */
  latest?: boolean;
}
