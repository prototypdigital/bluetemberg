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

/** Joins non-empty sections with a blank line and a single trailing newline (stable shape). */
function rejoin(...sections: string[]): string {
  const parts = sections.map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return parts.join('\n\n') + '\n';
}

/**
 * Returns `content` with the marker-fenced region removed (outer content preserved).
 * No-op when the markers are absent.
 */
export function stripManagedBlock(content: string, markers: BlockMarkers): string {
  const beginIdx = content.indexOf(markers.begin);
  const endIdx = content.indexOf(markers.end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return content;
  }
  const before = content.slice(0, beginIdx);
  const after = content.slice(endIdx + markers.end.length);
  return rejoin(before, after);
}

/**
 * Injects (or replaces, or removes) a managed block in `existing`.
 *
 * @param existing - Current file content, or `null` if the file does not exist.
 * @param inner - Generated body for the block. Empty/whitespace means "remove the block".
 * @returns The new file content. Empty string means "nothing to write" (caller should skip when
 *          the file did not previously exist).
 */
export function injectManagedBlock(existing: string | null, inner: string, markers: BlockMarkers): string {
  const trimmed = inner.trim();
  const block = trimmed.length > 0 ? `${markers.begin}\n${trimmed}\n${markers.end}` : '';

  if (existing === null) {
    return block.length > 0 ? block + '\n' : '';
  }

  const beginIdx = existing.indexOf(markers.begin);
  const endIdx = existing.indexOf(markers.end);
  const hasBlock = beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx;

  if (hasBlock) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + markers.end.length);
    return rejoin(before, block, after);
  }

  // No existing block: leave the file untouched when there is nothing to add.
  if (block.length === 0) {
    return existing;
  }
  return rejoin(existing, block);
}
