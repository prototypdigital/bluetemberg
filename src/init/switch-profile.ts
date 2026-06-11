import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PACK_VERSION,
  migrateLegacyManifests,
  readManifest,
  writeManifest,
} from '../registry/manifest.js';
import { INIT_TEAM_PROFILES } from './init-catalog.js';
import { agentsForProfile, skillsForProfile } from './init-answers-from-profile.js';
import { AGENT_PRESETS, SKILL_PRESETS } from './presets.js';
import type { PackageManifest, PresetItem, TeamProfile } from '../types.js';

export interface SwitchProfileOptions {
  silent?: boolean;
}

export interface SwitchProfileResult {
  fromProfile: TeamProfile | undefined;
  toProfile: TeamProfile;
  /** Agent/skill package names added to `llm/packages.json`. */
  added: string[];
  /**
   * Official agent/skill packages in the manifest that are not part of the new
   * profile's defaults. Reported for user review; not auto-removed. Rule
   * collections and third-party packs are never flagged — the profile switch
   * cannot know which kind they are.
   */
  stale: string[];
}

interface ApplyResult {
  added: string[];
  stale: string[];
}

export function switchProfile(
  root: string,
  toProfile: TeamProfile,
  options: SwitchProfileOptions = {},
): SwitchProfileResult {
  if (!INIT_TEAM_PROFILES.includes(toProfile)) {
    throw new Error(`Unknown profile "${toProfile}". Expected one of: ${INIT_TEAM_PROFILES.join(', ')}`);
  }

  const configPath = join(root, 'bluetemberg.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`No bluetemberg.config.json found in ${root}. Run "bluetemberg init" first.`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error(`Could not parse ${configPath} — check for JSON syntax errors.`);
  }
  const fromProfile =
    typeof raw.profile === 'string' && INIT_TEAM_PROFILES.includes(raw.profile as TeamProfile)
      ? (raw.profile as TeamProfile)
      : undefined;

  if (fromProfile === toProfile) {
    return { fromProfile, toProfile, added: [], stale: [] };
  }

  migrateLegacyManifests(root);
  const manifest = readManifestLenient(root);

  const added: string[] = [];
  const stale: string[] = [];

  const agentResult = applyPresets(manifest, agentsForProfile(toProfile), AGENT_PRESETS);
  added.push(...agentResult.added);
  stale.push(...agentResult.stale);

  const skillResult = applyPresets(manifest, skillsForProfile(toProfile), SKILL_PRESETS);
  added.push(...skillResult.added);
  stale.push(...skillResult.stale);

  if (added.length > 0) {
    writeManifest(root, manifest);
  }

  raw.profile = toProfile;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');

  if (!options.silent) {
    reportResult({ fromProfile, toProfile, added, stale });
  }

  return { fromProfile, toProfile, added, stale };
}

function readManifestLenient(root: string): PackageManifest {
  try {
    return readManifest(root);
  } catch {
    console.warn(
      `  Warning: could not parse ${join(root, 'llm', 'packages.json')} — treating as empty. Check for JSON syntax errors.`,
    );
    return { packages: {} };
  }
}

/**
 * Adds the target presets' packages to the manifest and reports stale entries.
 * Stale detection is scoped to packages known in `presets` — entries the preset
 * catalog does not recognize (rule collections, third-party packs) are left alone.
 */
function applyPresets(manifest: PackageManifest, targetIds: string[], presets: PresetItem[]): ApplyResult {
  const result: ApplyResult = { added: [], stale: [] };

  const targetPackages = new Set<string>();
  for (const id of targetIds) {
    const preset = presets.find((p) => p.id === id);
    if (!preset?.packageName) continue;
    targetPackages.add(preset.packageName);
    if (manifest.packages[preset.packageName]) continue;

    manifest.packages[preset.packageName] = DEFAULT_PACK_VERSION;
    result.added.push(preset.packageName);
  }

  const knownPackages = new Set(presets.map((p) => p.packageName).filter(Boolean));
  for (const pkgName of Object.keys(manifest.packages)) {
    if (knownPackages.has(pkgName) && !targetPackages.has(pkgName)) {
      result.stale.push(pkgName);
    }
  }

  return result;
}

function reportResult(result: SwitchProfileResult): void {
  const { fromProfile, toProfile, added, stale } = result;
  const from = fromProfile ?? '(unset)';
  console.log(`\n  Profile: ${from} → ${toProfile}\n`);

  if (added.length === 0) {
    console.log('  No new packages added.');
  } else {
    console.log(`  Added ${added.length} package(s) to llm/packages.json:`);
    for (const pkg of added) console.log(`    + ${pkg}`);
  }

  if (stale.length > 0) {
    console.log(
      `\n  ${stale.length} package(s) in llm/packages.json are not part of the "${toProfile}" defaults:`,
    );
    for (const pkg of stale) console.log(`    ? ${pkg}`);
    if (toProfile === 'custom') {
      console.log('  Note: custom profile has no fixed defaults — this list is informational only.');
    } else {
      console.log('  Review and remove manually if no longer needed.');
    }
  }

  console.log(
    '\n  Note: rule collections are not changed by profile switch — edit `llm/packages.json` manually if needed.',
  );
  console.log('\n  Next: run `bluetemberg sync` to regenerate platform files.\n');
}
