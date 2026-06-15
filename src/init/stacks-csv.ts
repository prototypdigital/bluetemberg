import { isValidStackRange } from '../stacks/match.js';

const AUTO = 'auto';

/** Result of parsing a `--stacks` CSV: the stack → version map plus any tokens that named no stack. */
export interface ParsedStacksCsv {
  /**
   * Stack name → version map. Whitespace is trimmed; a bare name or empty version becomes
   * `"auto"`. Last value wins on a duplicate name.
   */
  stacks: Record<string, string>;
  /** Tokens that resolved to an empty stack name (e.g. a leading `@`) and were skipped. */
  skipped: string[];
}

/**
 * Parse a `--stacks` CSV into a stack → version map. Each comma-separated token is `name`
 * (→ `"auto"`) or `name@version` (e.g. `payload@3.4.1`, `nextjs@auto`). Whitespace around the
 * token, name, and version is trimmed, so `"payload @ 3.4.1"` yields `{ payload: "3.4.1" }`.
 * A token whose name is empty (e.g. a leading `@`) names no stack and is reported in `skipped`
 * rather than silently dropped.
 */
export function parseStacksCsv(value: string): ParsedStacksCsv {
  const stacks: Record<string, string> = {};
  const skipped: string[] = [];

  for (const raw of value.split(',')) {
    const token = raw.trim();
    if (!token) continue;

    const at = token.indexOf('@');
    const name = (at === -1 ? token : token.slice(0, at)).trim();
    if (!name) {
      skipped.push(token);
      continue;
    }

    const version = (at === -1 ? '' : token.slice(at + 1)).trim() || AUTO;
    stacks[name] = version;
  }

  return { stacks, skipped };
}

/**
 * Stack names whose pinned version is neither the `"auto"` sentinel nor a valid semver range —
 * i.e. likely fat-fingered pins (e.g. `3..4`) that would silently never match a rule. Returns
 * `name@version` strings for the caller to surface as a warning.
 */
export function invalidStackVersions(stacks: Record<string, string>): string[] {
  return Object.entries(stacks)
    .filter(([, version]) => version !== AUTO && !isValidStackRange(version))
    .map(([name, version]) => `${name}@${version}`);
}
