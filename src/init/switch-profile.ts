import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../utils/fs.js';
import { INIT_TEAM_PROFILES } from './init-catalog.js';
import { agentsForProfile, rulesForTemplatesProfile, skillsForProfile } from './init-answers-from-profile.js';
import type { TeamProfile } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

export interface SwitchProfileOptions {
  silent?: boolean;
}

export interface SwitchProfileResult {
  fromProfile: TeamProfile | undefined;
  toProfile: TeamProfile;
  added: string[];
  /**
   * Paths in `llm/` not belonging to the new profile's defaults.
   * Rules and agent entries are file paths (`*.md`); skill entries are directory paths.
   */
  stale: string[];
}

interface AssetSpec {
  /** Subdirectory under `templates/` (also under `llm/`). */
  kind: 'rules' | 'agents' | 'skills';
  /** Selected ids for the target profile. */
  targetIds: string[];
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

  const specs: AssetSpec[] = [
    { kind: 'rules', targetIds: rulesForTemplatesProfile(toProfile) },
    { kind: 'agents', targetIds: agentsForProfile(toProfile) },
    { kind: 'skills', targetIds: skillsForProfile(toProfile) },
  ];

  const added: string[] = [];
  const stale: string[] = [];

  for (const spec of specs) {
    const result = applyAssetSpec(root, spec);
    added.push(...result.added);
    stale.push(...result.stale);
  }

  raw.profile = toProfile;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');

  if (!options.silent) {
    reportResult({ fromProfile, toProfile, added, stale });
  }

  return { fromProfile, toProfile, added, stale };
}

interface ApplyResult {
  added: string[];
  stale: string[];
}

function applyAssetSpec(root: string, spec: AssetSpec): ApplyResult {
  const destBase = join(root, 'llm', spec.kind);
  const result: ApplyResult = { added: [], stale: [] };

  for (const id of spec.targetIds) {
    const { src, dest } = resolveAssetPaths(spec.kind, id, destBase);
    if (!existsSync(src)) continue;
    if (existsSync(dest)) continue;

    ensureDir(dirname(dest));
    copyFileSync(src, dest);
    result.added.push(dest);
  }

  if (existsSync(destBase)) {
    const present = readPresentIds(spec.kind, destBase);
    const targetSet = new Set(spec.targetIds);
    for (const id of present) {
      if (!targetSet.has(id)) {
        result.stale.push(join(destBase, spec.kind === 'skills' ? id : `${id}.md`));
      }
    }
  }

  return result;
}

function resolveAssetPaths(
  kind: AssetSpec['kind'],
  id: string,
  destBase: string,
): { src: string; dest: string } {
  if (kind === 'skills') {
    return {
      src: join(TEMPLATES_DIR, 'skills', id, 'SKILL.md'),
      dest: join(destBase, id, 'SKILL.md'),
    };
  }
  return {
    src: join(TEMPLATES_DIR, kind, `${id}.md`),
    dest: join(destBase, `${id}.md`),
  };
}

function readPresentIds(kind: AssetSpec['kind'], dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (kind === 'skills') {
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.replace(/\.md$/, ''));
}

function reportResult(result: SwitchProfileResult): void {
  const { fromProfile, toProfile, added, stale } = result;
  const from = fromProfile ?? '(unset)';
  console.log(`\n  Profile: ${from} → ${toProfile}\n`);

  if (added.length === 0) {
    console.log('  No new template files needed.');
  } else {
    console.log(`  Added ${added.length} template file(s):`);
    for (const f of added) console.log(`    + ${f}`);
  }

  if (stale.length > 0) {
    console.log(`\n  ${stale.length} file(s) in llm/ are not part of the "${toProfile}" defaults:`);
    for (const f of stale) console.log(`    ? ${f}`);
    if (toProfile === 'custom') {
      console.log('  Note: custom profile has no fixed defaults — this list is informational only.');
    } else {
      console.log('  Review and delete manually if no longer needed.');
    }
  }

  console.log('\n  Next: run `bluetemberg sync` to regenerate platform files.\n');
}
