/**
 * Idempotent "managed block" injection for hand-authored files.
 *
 * Some Codex outputs (`AGENTS.md`, `.codex/config.toml`) are files the user also edits by hand.
 * Rather than overwrite them, we fence generated content between begin/end markers and only ever
 * touch the region between those markers — everything outside is preserved verbatim.
 *
 * The comment syntax differs per file type (`<!-- -->` for markdown, `#` for TOML), so callers
 * pass the marker strings. Re-running with the same input is a no-op (stable whitespace), which
 * keeps `sync --check` honest.
 *
 * Markers are paired positionally (a BEGIN, then the first END *after* it), never by taking the
 * first occurrence of each: an unpaired marker — the shape a badly resolved merge conflict leaves
 * behind — is ambiguous, so it raises {@link ManagedBlockError} instead of being worked around.
 * Guessing there appends a second block on every run, which grows the file without bound and makes
 * `sync --check` permanently red.
 */
export interface BlockMarkers {
  begin: string;
  end: string;
}

/** Markdown markers for the rules block injected into `AGENTS.md`. */
export const AGENTS_RULES_MARKERS: BlockMarkers = {
  begin: '<!-- BEGIN BLUETEMBERG MANAGED RULES -->',
  end: '<!-- END BLUETEMBERG MANAGED RULES -->',
};

/** TOML markers for the MCP server block injected into `.codex/config.toml`. */
export const CODEX_MCP_MARKERS: BlockMarkers = {
  begin: '# BEGIN BLUETEMBERG MANAGED MCP SERVERS',
  end: '# END BLUETEMBERG MANAGED MCP SERVERS',
};

/** Raised when a file's managed-block markers are malformed and cannot be paired safely. */
export class ManagedBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedBlockError';
  }
}

/** Half-open `[start, end)` span of one complete `begin ... end` block. */
interface BlockRange {
  start: number;
  end: number;
}

const REPAIR_HINT =
  'Markers must appear in matched pairs — commonly a merge conflict resolved by hand, or marker ' +
  'text quoted into the file. Repair the markers (delete the stray one, or restore its pair), ' +
  'then re-run bluetemberg sync.';

function malformed(filePath: string, detail: string): ManagedBlockError {
  return new ManagedBlockError(`${filePath}: malformed managed block — ${detail}. ${REPAIR_HINT}`);
}

/**
 * Locates every complete managed block, pairing each `begin` with the first `end` that follows it.
 *
 * @throws {ManagedBlockError} when a marker is unpaired (a `begin` with no `end` after it, an `end`
 *         outside any block) or nested (a second `begin` inside an open block).
 */
function findManagedBlocks(content: string, markers: BlockMarkers, filePath: string): BlockRange[] {
  const ranges: BlockRange[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const begin = content.indexOf(markers.begin, cursor);
    if (begin === -1) break;

    if (content.slice(cursor, begin).includes(markers.end)) {
      throw malformed(filePath, `found \`${markers.end}\` with no \`${markers.begin}\` before it`);
    }

    const end = content.indexOf(markers.end, begin + markers.begin.length);
    if (end === -1) {
      throw malformed(filePath, `\`${markers.begin}\` has no \`${markers.end}\` after it`);
    }

    if (content.slice(begin + markers.begin.length, end).includes(markers.begin)) {
      throw malformed(filePath, `a second \`${markers.begin}\` appears inside an open block`);
    }

    ranges.push({ start: begin, end: end + markers.end.length });
    cursor = end + markers.end.length;
  }

  if (content.slice(cursor).includes(markers.end)) {
    throw malformed(filePath, `found \`${markers.end}\` with no \`${markers.begin}\` before it`);
  }

  return ranges;
}

/**
 * Rejects generated content that carries a marker of its own.
 *
 * Emitting it writes a block no later run can pair, so sync would refuse the file from then on —
 * and deleting the source that introduced the marker does not heal it, because the wreckage is
 * already on disk. Sync must never author that state, so this fails before the first write.
 */
function assertMarkerFreeInner(inner: string, markers: BlockMarkers, filePath: string): void {
  for (const marker of [markers.begin, markers.end]) {
    if (!inner.includes(marker)) continue;
    throw new ManagedBlockError(
      `${filePath}: generated content contains the managed-block marker \`${marker}\`. Writing it ` +
        'would produce a block that cannot be paired on the next run. Reword the source so the ' +
        'literal marker does not appear in it.',
    );
  }
}

/** Joins non-empty sections with a blank line and a single trailing newline (stable shape). */
function rejoin(...sections: string[]): string {
  const parts = sections.map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return parts.join('\n\n') + '\n';
}

/**
 * Returns `content` with every marker-fenced region removed (outer content preserved).
 * No-op when the markers are absent.
 *
 * @param filePath - Label for diagnostics (a path relative to the project root).
 * @throws {ManagedBlockError} when the markers are malformed.
 */
export function stripManagedBlock(content: string, markers: BlockMarkers, filePath: string): string {
  const blocks = findManagedBlocks(content, markers, filePath);
  if (blocks.length === 0) return content;

  const sections: string[] = [];
  let cursor = 0;
  for (const range of blocks) {
    sections.push(content.slice(cursor, range.start));
    cursor = range.end;
  }
  sections.push(content.slice(cursor));

  return rejoin(...sections);
}

/**
 * Injects (or replaces, or removes) a managed block in `existing`.
 *
 * Duplicated blocks (both sides of a merge kept) collapse into the first one — the fenced region is
 * generated content by definition, so dropping the extras loses nothing and lets re-runs converge.
 *
 * @param existing - Current file content, or `null` if the file does not exist.
 * @param inner - Generated body for the block. Empty/whitespace means "remove the block".
 * @param filePath - Label for diagnostics (a path relative to the project root).
 * @returns The new file content. Empty string means "nothing to write" (caller should skip when
 *          the file did not previously exist).
 * @throws {ManagedBlockError} when `existing` has malformed markers, or when `inner` itself
 *         contains a marker (which would wedge the file on the next run).
 */
export function injectManagedBlock(
  existing: string | null,
  inner: string,
  markers: BlockMarkers,
  filePath: string,
): string {
  const trimmed = inner.trim();
  assertMarkerFreeInner(trimmed, markers, filePath);
  const block = trimmed.length > 0 ? `${markers.begin}\n${trimmed}\n${markers.end}` : '';

  if (existing === null) {
    return block.length > 0 ? block + '\n' : '';
  }

  const blocks = findManagedBlocks(existing, markers, filePath);

  if (blocks.length === 0) {
    // No existing block: leave the file untouched when there is nothing to add.
    if (block.length === 0) return existing;
    return rejoin(existing, block);
  }

  const sections: string[] = [];
  let cursor = 0;
  for (const [index, range] of blocks.entries()) {
    sections.push(existing.slice(cursor, range.start));
    if (index === 0) sections.push(block);
    cursor = range.end;
  }
  sections.push(existing.slice(cursor));

  return rejoin(...sections);
}
