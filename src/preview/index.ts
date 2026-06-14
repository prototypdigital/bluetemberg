import type { TeamProfile } from '../types.js';
import { type Catalog, type CatalogPack, loadCatalog } from '../catalog/index.js';

export interface PreviewOptions {
  /** Suppress output (still returns data). */
  silent?: boolean;
  /** Force re-fetch even if cache is fresh. */
  force?: boolean;
  /** Output channel — defaults to no-op when silent, process.stdout otherwise. */
  log?: (msg: string) => void;
}

function packsForProfile(catalog: Catalog, profile: TeamProfile): CatalogPack[] {
  return catalog.packs.filter((p) => p.universal || p.profiles.includes(profile));
}

function byKind(packs: CatalogPack[], kind: CatalogPack['kind']): CatalogPack[] {
  return packs.filter((p) => p.kind === kind);
}

function printSection(title: string, packs: CatalogPack[], log: (msg: string) => void): void {
  if (packs.length === 0) return;
  log(`\n${title} (${packs.length})`);
  for (const pack of packs) {
    const shortName = pack.name.replace(/^bluetemberg-(rules|agents|skills|guardrails)-/, '');
    log(`  ${pack.name}  ${pack.version}`);
    log(`    ${pack.description}`);
    if (pack.preview) {
      const preview = pack.preview.slice(0, 300).replace(/\n/g, ' ');
      log(`    └─ "${preview}${pack.preview.length > 300 ? '…' : ''}"`);
    }
    void shortName;
  }
}

export async function preview(
  root: string,
  profile: TeamProfile,
  options: PreviewOptions = {},
): Promise<void> {
  const { silent = false, force = false, log: logFn } = options;
  const log = silent ? () => {} : (logFn ?? ((msg: string) => process.stdout.write(msg + '\n')));

  const { catalog, fromCache } = await loadCatalog(root, force);

  const packs = packsForProfile(catalog, profile);

  if (!silent) {
    const cacheNote = fromCache ? ' (cached)' : '';
    log(`\nProfile: ${profile}${cacheNote}`);
    log('─'.repeat(40));

    printSection('Rules', byKind(packs, 'rules'), log);
    printSection('Guardrails', byKind(packs, 'guardrails'), log);
    printSection('Agents', byKind(packs, 'agents'), log);
    printSection('Skills', byKind(packs, 'skills'), log);

    const total = packs.length;
    const byKindCount = (['rules', 'agents', 'skills', 'guardrails'] as const)
      .map((k) => `${byKind(packs, k).length} ${k}`)
      .filter((s) => !s.startsWith('0'))
      .join(', ');
    log(`\nTotal: ${total} packs (${byKindCount})`);
    log(`\nRun \`bluetemberg init --profile ${profile}\` to scaffold this configuration.`);
  }
}

export async function previewList(
  options: { silent?: boolean; log?: (msg: string) => void } = {},
): Promise<void> {
  const { TEAM_PROFILES } = await import('../init/presets.js');
  if (!options.silent) {
    const log = options.log ?? ((msg: string) => process.stdout.write(msg + '\n'));
    log('\nAvailable profiles:');
    for (const p of TEAM_PROFILES) {
      log(`  ${p.id.padEnd(16)} ${p.description}`);
    }
    log('\nUsage: bluetemberg preview <profile>');
  }
}
