import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
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
  /** Package names added to the agent/skill manifests. */
  added: string[];
  /**
   * Package names present in the agent/skill manifests that are not part of
   * the new profile's defaults. Reported for user review; not auto-removed.
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

  const added: string[] = [];
  const stale: string[] = [];

  const agentResult = applyPackageManifest(root, 'agent', agentsForProfile(toProfile), AGENT_PRESETS);
  added.push(...agentResult.added);
  stale.push(...agentResult.stale);

  const skillResult = applyPackageManifest(root, 'skill', skillsForProfile(toProfile), SKILL_PRESETS);
  added.push(...skillResult.added);
  stale.push(...skillResult.stale);

  raw.profile = toProfile;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');

  if (!options.silent) {
    reportResult({ fromProfile, toProfile, added, stale });
  }

  return { fromProfile, toProfile, added, stale };
}

function readPackageManifest(manifestPath: string): PackageManifest {
  if (!existsSync(manifestPath)) return { packages: {} };
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    console.warn(
      `  Warning: could not parse ${manifestPath} — treating as empty. Check for JSON syntax errors.`,
    );
    return { packages: {} };
  }
}

function applyPackageManifest(
  root: string,
  kind: 'agent' | 'skill',
  targetIds: string[],
  presets: PresetItem[],
): ApplyResult {
  const manifestPath = join(root, 'llm', `${kind}-packages.json`);
  const manifest = readPackageManifest(manifestPath);
  const result: ApplyResult = { added: [], stale: [] };

  const targetPackages = new Set<string>();
  let changed = false;
  for (const id of targetIds) {
    const preset = presets.find((p) => p.id === id);
    if (!preset?.packageName) continue;
    targetPackages.add(preset.packageName);
    if (manifest.packages[preset.packageName]) continue;

    manifest.packages[preset.packageName] = '^0.1.0';
    result.added.push(preset.packageName);
    changed = true;
  }

  for (const pkgName of Object.keys(manifest.packages)) {
    if (!targetPackages.has(pkgName)) {
      result.stale.push(pkgName);
    }
  }

  if (changed) {
    ensureDir(dirname(manifestPath));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
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
    console.log(`  Added ${added.length} package(s) to manifests:`);
    for (const pkg of added) console.log(`    + ${pkg}`);
  }

  if (stale.length > 0) {
    console.log(`\n  ${stale.length} package(s) in manifests are not part of the "${toProfile}" defaults:`);
    for (const pkg of stale) console.log(`    ? ${pkg}`);
    if (toProfile === 'custom') {
      console.log('  Note: custom profile has no fixed defaults — this list is informational only.');
    } else {
      console.log('  Review and remove manually if no longer needed.');
    }
  }

  console.log(
    '\n  Note: rule collections are not changed by profile switch — edit `llm/rule-packages.json` manually if needed.',
  );
  console.log('\n  Next: run `bluetemberg sync` to regenerate platform files.\n');
}
