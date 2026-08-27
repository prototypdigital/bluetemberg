/**
 * Validation for guardrail condition regexes (`check.matches` / `check.not_matches`).
 *
 * These patterns are evaluated by bash `[[ "$v" =~ $re ]]`, i.e. as POSIX ERE compiled by
 * the host libc — not as JavaScript regexes. Two distinct failure modes turn a guardrail
 * that reads as protective in review into one that protects nothing, and both are silent:
 *
 * 1. **The pattern does not compile.** `[[ =~ ]]` returns status 2, distinct from 1 (no
 *    match). The generated hook treats 2 as a block (see `guardrails.ts`), so the control
 *    fails closed — but the guardrail then denies every matching tool call, which is not
 *    what the author intended either. Rejecting the pattern at sync time turns that into a
 *    named error the author can fix.
 * 2. **The pattern compiles to the wrong thing.** `\d` is not a digit class in ERE: BSD
 *    libc compiles it to a literal `d`, so `not_matches: '\d+'` quietly checks for the
 *    letter "d" and never fires. Nothing at runtime can detect this, because the regex
 *    compiled successfully — only rejecting the JS/Perl idiom at its source can.
 *
 * The scanner is deliberately conservative: it rejects only constructs that are invalid or
 * non-portable across libcs, because a false rejection breaks a working guardrail while a
 * false accept is still caught at runtime by the fail-closed status check.
 */

/** Character class names valid inside a `[[:name:]]` bracket expression. */
const POSIX_CLASSES = new Set([
  'alnum',
  'alpha',
  'blank',
  'cntrl',
  'digit',
  'graph',
  'lower',
  'print',
  'punct',
  'space',
  'upper',
  'xdigit',
]);

/**
 * Perl/JavaScript escapes with no portable ERE meaning, mapped to the remedy. GNU libc
 * accepts some of these as extensions and BSD libc compiles them to the bare letter, so
 * they behave differently on the author's machine and the installer's — the worst outcome
 * for a security control, since neither side sees an error.
 */
const NON_ERE_ESCAPES: Record<string, string> = {
  d: 'use [[:digit:]]',
  D: 'use [^[:digit:]]',
  w: 'use [[:alnum:]_]',
  W: 'use [^[:alnum:]_]',
  s: 'use [[:space:]]',
  S: 'use [^[:space:]]',
  b: 'word boundaries have no portable ERE form — match the surrounding characters explicitly',
  B: 'word boundaries have no portable ERE form — match the surrounding characters explicitly',
  '<': 'word boundaries have no portable ERE form — match the surrounding characters explicitly',
  '>': 'word boundaries have no portable ERE form — match the surrounding characters explicitly',
  A: 'use ^',
  z: 'use $',
  Z: 'use $',
  p: 'Unicode property classes have no portable ERE form',
  P: 'Unicode property classes have no portable ERE form',
};

/** `{n}`, `{n,}`, `{n,m}` — the only brace forms libc reads as an interval. */
const INTERVAL = /^\{(\d+)(?:,(\d*))?\}/;

/**
 * Returns the reason `pattern` is not a portable POSIX ERE, or `null` when it is one.
 *
 * @param pattern Raw regex string as written in guardrail frontmatter.
 */
export function ereIssue(pattern: string): string | null {
  let i = 0;
  let depth = 0;
  /** Can a repetition operator (`*`, `+`, `?`, `{n,m}`) legally follow the last token? */
  let repeatable = false;
  /** Was the last token itself a repetition operator? (`a**` and `a+?` do not compile.) */
  let repeated = false;
  /** Is the current alternation branch still empty? (`|a`, `a||b`, `a|` do not compile.) */
  let branchEmpty = true;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '\\') {
      const escaped = pattern[i + 1];
      if (escaped === undefined) return 'trailing backslash';
      const remedy = NON_ERE_ESCAPES[escaped];
      if (remedy) return `"\\${escaped}" is a Perl/JavaScript escape, not POSIX ERE — ${remedy}`;
      i += 2;
      [repeatable, repeated, branchEmpty] = [true, false, false];
      continue;
    }

    if (char === '[') {
      const end = bracketEnd(pattern, i);
      if (end === -1) return 'unterminated bracket expression "["';
      const unknown = unknownClass(pattern.slice(i, end));
      if (unknown) return unknown;
      i = end;
      [repeatable, repeated, branchEmpty] = [true, false, false];
      continue;
    }

    if (char === '(') {
      if (pattern[i + 1] === '?') {
        return 'group syntax "(?...)" (lookahead, non-capturing) is a Perl/JavaScript extension, not POSIX ERE';
      }
      depth += 1;
      i += 1;
      [repeatable, repeated, branchEmpty] = [false, false, true];
      continue;
    }

    if (char === ')') {
      if (depth === 0) return 'unbalanced ")" — escape it as "\\)" to match a literal parenthesis';
      depth -= 1;
      i += 1;
      [repeatable, repeated, branchEmpty] = [true, false, false];
      continue;
    }

    if (char === '|') {
      if (branchEmpty) return 'empty alternation branch around "|"';
      i += 1;
      [repeatable, repeated, branchEmpty] = [false, false, true];
      continue;
    }

    if (char === '*' || char === '+' || char === '?') {
      const issue = repetitionIssue(char, repeatable, repeated);
      if (issue) return issue;
      i += 1;
      [repeatable, repeated] = [false, true];
      continue;
    }

    if (char === '{') {
      const match = INTERVAL.exec(pattern.slice(i));
      if (!match) {
        // libc reads a brace not followed by a digit as a literal (`${`, `foo{bar}`), but a
        // digit-led brace is an interval attempt that must be well formed (`a{2` is a
        // compile error, not the literal "a{2").
        if (/^\{\d/.test(pattern.slice(i)))
          return 'unterminated interval — expected "{n}", "{n,}" or "{n,m}"';
        i += 1;
        [repeatable, repeated, branchEmpty] = [true, false, false];
        continue;
      }
      const issue = intervalIssue(match, repeatable, repeated);
      if (issue) return issue;
      i += match[0].length;
      [repeatable, repeated, branchEmpty] = [false, true, false];
      continue;
    }

    // `^` cannot carry a repetition operator (`^*` does not compile); every other literal can.
    i += 1;
    [repeatable, repeated, branchEmpty] = [char !== '^', false, false];
  }

  if (depth > 0) return 'unbalanced "(" — escape it as "\\(" to match a literal parenthesis';
  if (branchEmpty && pattern.length > 0) return 'empty alternation branch around "|"';
  return null;
}

/** Reason a repetition operator is misplaced, or `null` when it is legal here. */
function repetitionIssue(char: string, repeatable: boolean, repeated: boolean): string | null {
  if (repeated) {
    if (char === '?') {
      return 'non-greedy quantifiers ("*?", "+?") are a Perl/JavaScript extension, not POSIX ERE';
    }
    return `"${char}" repeats a repetition operator`;
  }
  if (!repeatable) return `"${char}" has nothing to repeat`;
  return null;
}

/** Reason an otherwise well-formed `{n,m}` interval is invalid here, or `null`. */
function intervalIssue(match: RegExpExecArray, repeatable: boolean, repeated: boolean): string | null {
  if (repeated) return `interval "${match[0]}" repeats a repetition operator`;
  if (!repeatable) return `interval "${match[0]}" has nothing to repeat`;
  const max = match[2];
  if (max !== undefined && max !== '' && Number(max) < Number(match[1])) {
    return `interval "${match[0]}" has a maximum below its minimum`;
  }
  return null;
}

/**
 * Index just past the closing `]` of the bracket expression opening at `open`, or `-1` when
 * it is unterminated. A leading `^` and a leading `]` are part of the expression, and
 * `[:class:]` / `[.collate.]` / `[=equiv=]` may contain a `]` of their own.
 */
function bracketEnd(pattern: string, open: number): number {
  let i = open + 1;
  if (pattern[i] === '^') i += 1;
  if (pattern[i] === ']') i += 1;

  while (i < pattern.length) {
    const inner = pattern[i + 1];
    if (pattern[i] === '[' && inner !== undefined && ':.='.includes(inner)) {
      const close = pattern.indexOf(`${inner}]`, i + 2);
      if (close === -1) return -1;
      i = close + 2;
      continue;
    }
    if (pattern[i] === ']') return i + 1;
    i += 1;
  }

  return -1;
}

/** Reason a bracket expression names a character class libc does not know, or `null`. */
function unknownClass(bracket: string): string | null {
  for (const match of bracket.matchAll(/\[:([^:\]]*):\]/g)) {
    if (!POSIX_CLASSES.has(match[1])) return `unknown character class "[:${match[1]}:]"`;
  }
  return null;
}
