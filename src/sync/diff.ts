/**
 * Minimal line-level unified-diff renderer for `sync --check --diff`. Hand-rolled over line arrays
 * to avoid pulling in a diff dependency (none is in `package.json`). Output is indented to nest
 * under the `OUT OF SYNC: <path>` line and is bounded by collapsing unchanged runs into hunks.
 */

const CONTEXT = 3;

/**
 * Split text into lines, stripping the phantom empty element produced by a terminal `\n`.
 * A file that ends with `\n` has N real lines, not N+1 — this keeps counts and diffs accurate.
 */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function pluralLines(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`;
}

type DiffType = 'add' | 'del' | 'eq';

interface DiffLine {
  type: DiffType;
  text: string;
  /** 1-based line number in the original (existing) file; 0 for added lines. */
  oldNo: number;
  /** 1-based line number in the new (rendered) content; 0 for removed lines. */
  newNo: number;
}

/** Longest-common-subsequence line diff. Files here are small generated configs, so O(n·m) is fine. */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 0;
  let newNo = 0;
  const eq = (text: string): void => void out.push({ type: 'eq', text, oldNo: ++oldNo, newNo: ++newNo });
  const del = (text: string): void => void out.push({ type: 'del', text, oldNo: ++oldNo, newNo: 0 });
  const add = (text: string): void => void out.push({ type: 'add', text, oldNo: 0, newNo: ++newNo });

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      eq(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      del(a[i]);
      i++;
    } else {
      add(b[j]);
      j++;
    }
  }
  while (i < n) del(a[i++]);
  while (j < m) add(b[j++]);
  return out;
}

/** Group changed-line indices into hunks, padded by {@link CONTEXT} and merged when they overlap. */
function buildHunks(diff: DiffLine[]): Array<[number, number]> {
  const hunks: Array<[number, number]> = [];
  for (let idx = 0; idx < diff.length; idx++) {
    if (diff[idx].type === 'eq') continue;
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(diff.length - 1, idx + CONTEXT);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
      continue;
    }
    hunks.push([start, end]);
  }
  return hunks;
}

function prefixFor(type: DiffType): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

/**
 * Render a unified diff between the on-disk `existing` content and the freshly rendered `content`.
 * `existing` is `null` when the output file does not exist yet (a brand-new generated file).
 * Returns indented log lines: a summary count, then `@@` hunks with `+`/`-`/context lines.
 *
 * Note: the new-file format intentionally omits the `@@ -0,0 +1,N @@` hunk header used by standard
 * unified diff — bare `+line` lines are clearer in a nested CLI log context.
 */
export function renderUnifiedDiff(existing: string | null, content: string): string[] {
  if (existing === null) {
    const added = splitLines(content);
    const lines = [`    ~ new file, ${pluralLines(added.length)} added`];
    for (const text of added) lines.push(`    +${text}`);
    return lines;
  }

  const diff = diffLines(splitLines(existing), splitLines(content));
  const added = diff.filter((d) => d.type === 'add').length;
  const removed = diff.filter((d) => d.type === 'del').length;

  // Trailing-newline-only differences collapse to zero after splitLines — surface them explicitly.
  if (added === 0 && removed === 0) {
    return ['    ~ trailing newline difference only'];
  }

  const lines = [`    ~ ${pluralLines(added)} added, ${pluralLines(removed)} removed`];
  for (const [start, end] of buildHunks(diff)) {
    const slice = diff.slice(start, end + 1);
    const oldNos = slice.filter((d) => d.type !== 'add').map((d) => d.oldNo);
    const newNos = slice.filter((d) => d.type !== 'del').map((d) => d.newNo);
    const oldStart = oldNos[0] ?? 0;
    const newStart = newNos[0] ?? 0;
    lines.push(`    @@ -${oldStart},${oldNos.length} +${newStart},${newNos.length} @@`);
    for (const d of slice) lines.push(`    ${prefixFor(d.type)}${d.text}`);
  }
  return lines;
}
