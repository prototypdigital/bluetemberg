// Refresh the committed catalog snapshot from the packs repo `main` branch.
// Run with `npm run sync:catalog`. The snapshot is the offline floor read by
// `src/catalog/index.ts`; the project cache and live fetch layer on top of it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CATALOG_URL = 'https://raw.githubusercontent.com/prototypdigital/bluetemberg-packs/main/catalog.json';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'catalog', 'catalog.json');
const VALID_KINDS = new Set(['rules', 'agents', 'skills', 'guardrails']);

const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) {
  console.error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const json = await res.json();
if (!json || typeof json.generated !== 'string' || !Array.isArray(json.packs)) {
  console.error('Invalid catalog format: missing "generated" or "packs" is not an array');
  process.exit(1);
}

for (const pack of json.packs) {
  if (
    typeof pack.name !== 'string' ||
    typeof pack.version !== 'string' ||
    !VALID_KINDS.has(pack.kind) ||
    !Array.isArray(pack.profiles) ||
    !pack.profiles.every((p) => typeof p === 'string')
  ) {
    console.error(
      `Invalid catalog format: pack "${pack.name ?? '?'}" missing required fields or has invalid kind/profiles`,
    );
    process.exit(1);
  }
}

writeFileSync(OUT, JSON.stringify(json, null, 2) + '\n');
console.log(`Wrote ${json.packs.length} packs to src/catalog/catalog.json (generated ${json.generated}).`);
