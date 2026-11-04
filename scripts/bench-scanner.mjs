#!/usr/bin/env node
/**
 * Measure the content scanner against public prompt-injection datasets. Maintainer tool, not run in
 * CI: it fetches rows from the Hugging Face datasets server, so results need network access.
 *
 *   npm run build && npm run bench:scanner
 *
 * Datasets (licences from their Hugging Face cards):
 * - deepset/prompt-injections (Apache-2.0): labelled injections and benign prompts. The benign rows
 *   give the false-positive rate.
 * - Lakera/gandalf_ignore_instructions (MIT): injection attempts only.
 *
 * The scanner is not a prompt-injection classifier: it catches known-bad commands and hidden text,
 * and blocks only the cruder override phrasing. These numbers keep the docs honest about that.
 */
import { scanText } from '../dist/registry/scanner.js';

const ROWS_API = 'https://datasets-server.huggingface.co/rows';
const PAGE = 100;

async function fetchRows(dataset, split) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${ROWS_API}?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&length=${PAGE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${dataset}/${split}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page.rows.map((r) => r.row));
    if (page.rows.length < PAGE) return rows;
  }
}

function blockRate(texts) {
  const blocked = texts.filter((t) =>
    scanText(t, 'llm/skills/x/SKILL.md').some((f) => f.severity === 'block'),
  ).length;
  return `${blocked}/${texts.length} (${((100 * blocked) / texts.length).toFixed(1)}%)`;
}

const deepset = [
  ...(await fetchRows('deepset/prompt-injections', 'train')),
  ...(await fetchRows('deepset/prompt-injections', 'test')),
];
const gandalf = (
  await Promise.all(
    ['train', 'validation', 'test'].map((s) => fetchRows('Lakera/gandalf_ignore_instructions', s)),
  )
).flat();

console.log('Blocked by the content scan:');
console.log(`  deepset injections   ${blockRate(deepset.filter((r) => r.label === 1).map((r) => r.text))}`);
console.log(`  deepset benign (FP)  ${blockRate(deepset.filter((r) => r.label === 0).map((r) => r.text))}`);
console.log(`  gandalf ignore-instr ${blockRate(gandalf.map((r) => r.text))}`);
