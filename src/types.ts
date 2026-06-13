export type Platform = 'cursor' | 'claude' | 'copilot' | 'gemini' | 'windsurf' | 'claude-marketplace';
export const MARKETPLACE_PLATFORM = 'claude-marketplace' satisfies Platform;

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export type TeamProfile =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'devops'
  | 'pure-infra'
  | 'agentic'
  | 'custom';

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
   * GitHub repository in `owner/repo` format that hosts the published marketplace output.
   * When set, bluetemberg writes this value into `.claude/settings.json` under
   * `extraKnownMarketplaces` so Claude Desktop auto-prompts teammates to install plugins
   * when they open the project. The CI workflow scaffolded by `bluetemberg init` uses this
   * value to push generated `plugins/` and `.claude-plugin/` output to that repo.
   */
  remote?: string;
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
  /**
   * Team profile selected at init time. Recorded for tooling (e.g. `switch-profile`)
   * and to show what baseline the project was scaffolded from. Sync ignores this field —
   * `llm/` remains the source of truth.
   */
  profile?: TeamProfile;
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

export type RuleSource = 'collections' | 'none';

export interface GitHubScaffoldConfig {
  /** Project CI: typecheck, lint, test on push and PR. */
  ci: boolean;
  /** CodeQL static analysis for security vulnerabilities (free for public repos). */
  codeql: boolean;
  /** Block PRs that introduce vulnerable or license-incompatible dependencies. */
  dependencyReview: boolean;
  /** Auto-update npm and GitHub Actions dependencies weekly. */
  dependabot: boolean;
  /** Structured bug report and feature request issue templates. */
  issueTemplates: boolean;
  /** Pull request checklist template. */
  prTemplate: boolean;
  /** Assign default PR reviewers by file path. */
  codeowners: boolean;
  /** Auto-create GitHub Release with generated notes on version tags. */
  releaseWorkflow: boolean;
  /** Close stale issues and PRs after 60 days of inactivity. */
  staleBot: boolean;
  /** Deploy a docs site to GitHub Pages on push to main. */
  pagesWorkflow: boolean;
  /** CONTRIBUTING.md with contribution guidelines. */
  contributing: boolean;
  /** MIT LICENSE file in repo root. */
  license: boolean;
  /** CODE_OF_CONDUCT.md (Contributor Covenant 2.1). */
  codeOfConduct: boolean;
  /** SECURITY.md with vulnerability reporting instructions. */
  security: boolean;
  /** Enforce Conventional Commits PR title format via GitHub Actions. */
  semanticPr: boolean;
  /** Auto-label PRs by changed file paths. */
  autoLabeler: boolean;
  /** Lock closed issues and PRs after inactivity. */
  lockClosed: boolean;
}

export interface RuleCollectionPreset {
  id: string;
  name: string;
  packageName: string;
  description: string;
  rules: string[];
  /** When true, this collection is included for every non-custom profile without needing explicit tags. */
  universal?: boolean;
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
  /** `owner/repo` for the dedicated marketplace repo. Empty string = not configured. */
  marketplaceRemote?: string;
  /** Plugin pack IDs to distribute (e.g. `['frontend', 'fullstack']`). Empty = single project plugin. */
  marketplacePlugins?: string[];
  includeGuardrails?: boolean;
  guardrails?: string[];
  /** External source spec strings (e.g. `github:owner/repo#HEAD:rules`). Written to `llm/rule-sources.json`. */
  externalSources?: string[];
  /** GitHub repository file scaffolding (CI, security, templates). Omitted = no GitHub files generated. */
  github?: GitHubScaffoldConfig;
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

export interface GuardrailCheck {
  /** JSON field in the tool input to examine (e.g. `"name"`). */
  field: string;
  /** Block if the field value is empty or missing. */
  not_empty?: boolean;
  /** Block if the field value matches this regex pattern. */
  not_matches?: string;
  /** Block if the field value does NOT match this regex pattern. */
  matches?: string;
}

export interface GuardrailFrontmatter {
  description?: string;
  /** Tool name this guardrail fires on (e.g. `"EnterWorktree"`). */
  trigger: string;
  /** Hook phase. Defaults to `"PreToolUse"`. */
  hook_type?: 'PreToolUse' | 'PostToolUse';
  /** Condition that must pass — fails → hook blocks and shows message. */
  check: GuardrailCheck;
  /** Error message shown to the AI when the condition fails. */
  message: string;
  /** Platforms that support this guardrail. Defaults to all supported platforms. */
  platforms?: Platform[];
  /** Team profiles for marketplace plugin filtering. */
  profiles?: TeamProfile[];
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
  /** npm package name in the packs repo (e.g. `bluetemberg-agents-frontend-specialist`). */
  packageName?: string;
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
// Registry — community packs (rules, agents, skills)
// ---------------------------------------------------------------------------

/** Manifest file (`llm/packages.json`) — committed to version control. */
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

/** Lockfile (`llm/packages-lock.json`) — committed to version control. */
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
  /**
   * Resolve every pack and print the install plan without writing anything to disk.
   * Exits non-zero if any pack would fail to resolve.
   */
  dryRun?: boolean;
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
