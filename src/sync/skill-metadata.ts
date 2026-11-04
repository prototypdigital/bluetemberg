import { type FrontmatterFile, parseFrontmatter, stringifyFrontmatter } from '../utils/frontmatter.js';
import type { PackSource } from '../registry/index.js';

/**
 * A skill synced from a registry pack records which pack it came from in its `SKILL.md` frontmatter,
 * under `metadata`: the Agent Skills spec's own string-to-string map for client properties, and one
 * of the few fields every host (including the Claude API's strict validator) accepts. Keys are
 * prefixed so they never collide with the pack author's own `metadata` entries.
 *
 * The values come from the lockfile, never from the output: `integrity` is the pack tarball's hash,
 * which `verify` recomputes from the cached tarball, so stamping the output cannot change it.
 */
export const SKILL_METADATA_KEYS = {
  pack: 'bluetemberg-pack',
  version: 'bluetemberg-version',
  integrity: 'bluetemberg-integrity',
} as const;

const FRONTMATTER = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stampEntries(pack: PackSource): Record<string, string> {
  return {
    [SKILL_METADATA_KEYS.pack]: pack.name,
    [SKILL_METADATA_KEYS.version]: pack.version,
    [SKILL_METADATA_KEYS.integrity]: pack.integrity,
  };
}

/**
 * Appends a `metadata` block to the frontmatter text as is, so the author's formatting survives
 * byte for byte. JSON strings are valid YAML double-quoted scalars.
 */
function appendMetadataBlock(content: string, match: RegExpExecArray, pack: PackSource): string {
  const eol = match[1];
  const lines = Object.entries(stampEntries(pack)).map(
    ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
  );
  const head = `---${eol}${match[2]}${eol}metadata:${eol}${lines.join(eol)}${eol}---${eol}`;
  return head + content.slice(match[0].length);
}

/**
 * Stamps the pack's name, version and integrity into a skill's `metadata`. A skill with no
 * frontmatter is returned unchanged. Throws when the frontmatter is not valid YAML or its
 * `metadata` is not a map, which the caller reports.
 */
export function stampSkillMetadata(content: string, pack: PackSource): string {
  // A UTF-8 BOM would stop the frontmatter matching, and every host skips it the same way.
  const bom = content.startsWith(BOM) ? BOM : '';
  const text = content.slice(bom.length);
  const match = FRONTMATTER.exec(text);
  if (!match) return content;

  const parsed = parseFrontmatter(text);
  if (!('metadata' in parsed.data)) {
    const appended = appendMetadataBlock(text, match, pack);
    // Appending is only safe after block-style YAML; a flow map (`{name: a}`) or a frontmatter
    // ending in `...` would not parse with a block after it, so those take the merge path.
    if (carriesStamp(appended, pack)) return bom + appended;
    return bom + mergeStamp(parsed, {}, pack);
  }
  // An empty `metadata:` parses as null; it is a key all the same, so it is merged into, not repeated.
  const metadata: unknown = parsed.data.metadata ?? {};
  if (!isPlainObject(metadata)) {
    throw new Error('frontmatter `metadata` must be a map of strings (Agent Skills spec)');
  }
  return bom + mergeStamp(parsed, metadata, pack);
}

const BOM = '\uFEFF';

/** Whether `content` parses and its `metadata` holds the stamp. */
function carriesStamp(content: string, pack: PackSource): boolean {
  try {
    const metadata: unknown = parseFrontmatter(content).data.metadata;
    if (!isPlainObject(metadata)) return false;
    return Object.entries(stampEntries(pack)).every(([key, value]) => metadata[key] === value);
  } catch {
    return false;
  }
}

/**
 * The author already has a `metadata` map (or frontmatter text cannot take an appended block):
 * merge into it. Re-serializing is the only safe way to edit a nested YAML map; a stamp key the
 * source already carries is replaced, never repeated. Comments in that frontmatter are lost.
 */
function mergeStamp(parsed: FrontmatterFile, metadata: Record<string, unknown>, pack: PackSource): string {
  const data = { ...parsed.data, metadata: { ...metadata, ...stampEntries(pack) } };
  return stringifyFrontmatter(parsed.content, data);
}
