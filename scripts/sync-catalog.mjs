// Refresh the committed catalog snapshot from the packs repo `main` branch.
// Run with `npm run sync:catalog`. The snapshot is the offline floor read by
// `src/catalog/index.ts`; the project cache and live fetch layer on top of it.
// `npm run sync:catalog -- --check` writes nothing and exits 1 when the snapshot is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';

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

// Reduce item arrays to string ids — the engine consumes ids, not the packs repo's richer
// `{ name, description }` objects. Keeps the committed snapshot compact and shape-stable.
const ITEM_KINDS = ['rules', 'agents', 'skills', 'guardrails'];
for (const pack of json.packs) {
  for (const kind of ITEM_KINDS) {
    if (Array.isArray(pack[kind])) {
      pack[kind] = pack[kind]
        .map((item) => (typeof item === 'string' ? item : item?.name))
        .filter((id) => typeof id === 'string' && id.length > 0);
    }
  }
}

// Format with the project's Prettier config so the snapshot passes `format:check` as written.
const next = await format(JSON.stringify(json), { ...(await resolveConfig(OUT)), filepath: OUT });

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current === next) {
    console.log(`Catalog snapshot is current (${json.packs.length} packs, generated ${json.generated}).`);
    process.exit(0);
  }
  const committed = JSON.parse(current);
  console.error(
    `Catalog snapshot is stale: committed ${committed.packs?.length ?? '?'} packs (generated ${committed.generated}), ` +
      `packs main has ${json.packs.length} (generated ${json.generated}). Run \`npm run sync:catalog\` and commit the result.`,
  );
  process.exit(1);
}

writeFileSync(OUT, next);
console.log(`Wrote ${json.packs.length} packs to src/catalog/catalog.json (generated ${json.generated}).`);
