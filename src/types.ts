export type Platform = "cursor" | "claude" | "copilot";

export type PackageManager = "pnpm" | "npm" | "yarn";

export interface TargetConfig {
  dir: string;
  ext: string;
}

export interface SkillTargetConfig {
  dir: string;
}

export interface BlueprintConfig {
  platforms: Platform[];
  source: string;
  targets: {
    rules?: Partial<Record<Platform, TargetConfig>>;
    agents?: Partial<Record<Platform, TargetConfig>>;
    skills?: Partial<Record<Platform, SkillTargetConfig>>;
  };
}

export interface InitAnswers {
  projectName: string;
  projectDescription: string;
  packageManager: PackageManager;
  platforms: Platform[];
  rules: string[];
  includeAgents: boolean;
  agents: string[];
  includeSkills: boolean;
  skills: string[];
  includeMcp: boolean;
  mcpServers: string[];
}

export interface SyncOptions {
  check?: boolean;
  config?: BlueprintConfig;
  silent?: boolean;
}

export interface SyncResults {
  synced: number;
  outOfSync: number;
  errors: string[];
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
}

export interface PlatformChoice {
  id: Platform;
  name: string;
}

export interface PackageManagerChoice {
  id: PackageManager;
  name: string;
}
