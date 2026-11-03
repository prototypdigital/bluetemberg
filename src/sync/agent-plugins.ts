import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix, sep } from 'node:path';
import matter from 'gray-matter';
import { commitPlannedCopy, commitPlannedWrite, type SyncSink } from './pipeline.js';
import { listSkillSupportingFiles } from './skill-files.js';
import type { MarketplaceOwner, PackageLock, PackageLockEntry, Stack, TeamProfile } from '../types.js';

/**
 * Agent Plugins (https://agent-plugins.org) output. A plugin is a directory with a closed root
 * `plugin.json`, skills under `skills/<name>/SKILL.md`, and client-owned files under top-level
 * reverse-domain directories. VS Code, Copilot CLI, Codex and Cursor read a root `plugin.json` that
 * declares the canonical `$schema`, ahead of their own legacy manifests (`.claude-plugin/`, …), so
 * the bundle lives in the same `plugins/<name>/` directory the Claude marketplace output uses.
 */
export const AGENT_PLUGINS_SPEC_VERSION = '1.0.0';
export const AGENT_PLUGINS_SCHEMA_ID = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_SPEC_VERSION}/plugin.schema.json`;
/** Copilot's extension namespace: VS Code and Copilot CLI load `agents/` under it for Agent Plugins bundles. */
export const COPILOT_EXTENSION_DIR = 'com.github.copilot';
/** Bluetemberg's own extension namespace (prototyp.digital). Clients ignore namespaces they don't implement. */
export const BLUETEMBERG_EXTENSION_DIR = 'digital.prototyp.bluetemberg';
/**
 * Pack provenance and per-file digests. The spec closes `plugin.json` to its own fields and leaves
 * integrity to future versions, so this lives in bluetemberg's extension directory, which keeps the
 * manifest schema-valid.
 */
export const BUNDLE_LOCK_FILE = `${BLUETEMBERG_EXTENSION_DIR}/bundle-lock.json`;
export const AGENT_PLUGINS_MANIFEST = 'plugin.json';

const NAME_MAX_LENGTH = 64;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** Spec §5.5: 1–64 chars of `a-z0-9.-`, alphanumeric at both ends, no `--` or `..`. */
export function isValidAgentPluginName(name: string): boolean {
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return false;
  if (name.includes('--') || name.includes('..')) return false;
  return NAME_PATTERN.test(name);
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Why a skill breaks the Agent Skills spec rules a host checks before loading it, or `null`: the
 * frontmatter parses, `name` matches the directory and is lowercase-hyphenated (at most 64 chars),
 * and `description` is 1–1024 chars. Agent Plugins hosts skip a skill that fails (spec §7.1).
 */
export function agentSkillIssue(skillDir: string, content: string): string | null {
  let data: Record<string, unknown>;
  try {
    data = matter(content).data as Record<string, unknown>;
  } catch {
    return 'its frontmatter is not valid YAML';
  }
  if (!SKILL_NAME_PATTERN.test(skillDir) || skillDir.length > NAME_MAX_LENGTH) {
    return 'the directory name must be lowercase letters, digits and single hyphens, at most 64 chars';
  }
  if (data.name !== skillDir) return `"name" must equal the directory name "${skillDir}"`;
  const description = data.description;
  if (typeof description !== 'string' || description.length === 0) return '"description" is missing';
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) return '"description" is over 1024 chars';
  return null;
}

/** Subresource-integrity form, matching the `integrity` field of `packages-lock.json`. */
function sha256(bytes: Buffer | string): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

function toPosix(rel: string): string {
  return rel.split(sep).join(posix.sep);
}

/**
 * Writes files under one plugin directory and records each one's digest by its plugin-relative
 * path. Digests come from the bytes being written (or the copy's source), so `--check` produces the
 * same lock as a write pass.
 */
export class BundleFiles {
  readonly digests = new Map<string, string>();

  constructor(
    private readonly sink: SyncSink,
    readonly dir: string,
  ) {}

  write(rel: string, content: string): void {
    commitPlannedWrite(this.sink, join(this.dir, rel), content);
    this.digests.set(toPosix(rel), sha256(content));
  }

  /** A skill's supporting files (`scripts/`, `references/`, …), byte for byte. */
  copySkillFiles(srcSkillDir: string, relOutDir: string): void {
    for (const rel of listSkillSupportingFiles(srcSkillDir)) {
      const src = join(srcSkillDir, rel);
      const out = join(relOutDir, rel);
      commitPlannedCopy(this.sink, src, join(this.dir, out));
      this.digests.set(toPosix(out), sha256(readFileSync(src)));
    }
  }
}

export interface AgentPluginBundleInput {
  name: string;
  description?: string;
  owner?: MarketplaceOwner;
  /** `marketplace.remote` (`owner/repo`), published as the manifest's `repository`. */
  remote?: string;
  profiles?: TeamProfile[];
  stacks?: Stack[];
  /** npm names of the packs whose content landed in this bundle. */
  packNames: ReadonlySet<string>;
}

/** Only the closed field set of spec §5.2; empty optional fields are left out. */
export function buildAgentPluginManifest(input: AgentPluginBundleInput): Record<string, unknown> {
  const keywords = [...(input.profiles ?? []), ...(input.stacks ?? [])];
  return {
    $schema: AGENT_PLUGINS_SCHEMA_ID,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.owner?.name ? { author: input.owner } : {}),
    ...(input.remote ? { repository: `https://github.com/${input.remote}` } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

function lockedPacks(
  packNames: ReadonlySet<string>,
  lock: PackageLock | undefined,
): Record<string, PackageLockEntry> {
  const out: Record<string, PackageLockEntry> = {};
  for (const name of [...packNames].sort()) {
    const entry = lock?.packages[name];
    if (entry) out[name] = entry;
  }
  return out;
}

/**
 * Lock for one bundle: the `packages-lock.json` entries of the packs it was built from, and a digest
 * of every file an Agent Plugins client reads from it, `plugin.json` included (only the lock itself
 * is left out).
 */
export function buildBundleLock(
  files: BundleFiles,
  packNames: ReadonlySet<string>,
  lock: PackageLock | undefined,
): Record<string, unknown> {
  const digests = [...files.digests.entries()]
    .filter(
      ([rel]) =>
        rel === AGENT_PLUGINS_MANIFEST ||
        rel.startsWith('skills/') ||
        rel.startsWith(`${COPILOT_EXTENSION_DIR}/`),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    lockfileVersion: 1,
    generator: 'bluetemberg',
    agentPlugins: AGENT_PLUGINS_SPEC_VERSION,
    packs: lockedPacks(packNames, lock),
    files: Object.fromEntries(digests),
  };
}

/** Whether `path` is a bundle lock bluetemberg wrote (as opposed to a file someone put there). */
export function isBluetembergBundleLock(path: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isObject(parsed) && parsed.generator === 'bluetemberg';
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Writes the root `plugin.json`, then the bundle lock over everything written so far. Call after
 * every content file is written. A `plugin.json` that is already there without bluetemberg's lock
 * beside it was written by someone else; it is replaced, with a warning.
 */
export function writeAgentPluginBundle(
  files: BundleFiles,
  input: AgentPluginBundleInput,
  lock: PackageLock | undefined,
  warn: (msg: string) => void,
): void {
  const manifest = `${JSON.stringify(buildAgentPluginManifest(input), null, 2)}\n`;
  warnIfReplacingForeignManifest(files.dir, manifest, warn);
  files.write(AGENT_PLUGINS_MANIFEST, manifest);
  files.write(
    BUNDLE_LOCK_FILE,
    `${JSON.stringify(buildBundleLock(files, input.packNames, lock), null, 2)}\n`,
  );
}

function warnIfReplacingForeignManifest(
  pluginDir: string,
  manifest: string,
  warn: (msg: string) => void,
): void {
  const manifestPath = join(pluginDir, AGENT_PLUGINS_MANIFEST);
  if (!existsSync(manifestPath) || isBluetembergBundleLock(join(pluginDir, BUNDLE_LOCK_FILE))) return;
  if (readFileSync(manifestPath, 'utf8') === manifest) return;
  warn(
    `agent-plugins: ${posix.join('plugins', basename(pluginDir), AGENT_PLUGINS_MANIFEST)} was not written by bluetemberg and is replaced — move any hand-written fields into marketplace config`,
  );
}
