import { describe, it, expect } from 'vitest';
import { ereIssue } from '../src/sync/ere.js';

/**
 * `ereIssue` guards GHSA-grpx-fj8v-q8g9: guardrail condition regexes are compiled by the
 * host libc as POSIX ERE, not by JavaScript. Expectations here were taken from the actual
 * exit status of `[[ "$v" =~ $re ]]` under `/bin/bash`, not from JS regex semantics.
 */
describe('ereIssue', () => {
  it('accepts the patterns real guardrails use', () => {
    const valid = [
      '^claude/',
      'rm -rf',
      '^(feat|fix|chore|refactor|docs|test)/[a-z0-9-]+$',
      'console\\.log\\(',
      'NEXT_PUBLIC_(SECRET|TOKEN|PRIVATE)',
      '[0-9]{1,3}\\.[0-9]{1,3}',
      '[[:space:]]*$',
      '[A-Za-z_][A-Za-z0-9_]*',
      '.*',
      '[]a]',
      '[^]a]',
    ];

    expect(valid.filter((p) => ereIssue(p) !== null)).toEqual([]);
  });

  it('treats a brace that libc reads as a literal as valid', () => {
    // Only a digit-led brace is an interval attempt; `${` and `foo{bar}` compile as literals
    // and must not be rejected.
    for (const pattern of ['${', 'a{', '{', 'foo{bar}', 'a{,3}', 'a{2,}', 'a{2,3}', 'x{0}']) {
      expect(ereIssue(pattern), pattern).toBeNull();
    }
  });

  it.each([
    ['[', 'unterminated bracket expression'],
    ['[a-', 'unterminated bracket expression'],
    ['[[:alpha', 'unterminated bracket expression'],
    ['[[:foo:]]', 'unknown character class'],
    ['(a', 'unbalanced "("'],
    ['((a)', 'unbalanced "("'],
    ['a)', 'unbalanced ")"'],
    ['a\\', 'trailing backslash'],
    ['*x', 'nothing to repeat'],
    ['+x', 'nothing to repeat'],
    ['?x', 'nothing to repeat'],
    ['^*', 'nothing to repeat'],
    ['(*a)', 'nothing to repeat'],
    ['{2}', 'nothing to repeat'],
    ['a{2', 'unterminated interval'],
    ['a{3,2}', 'maximum below its minimum'],
    ['a**', 'repeats a repetition operator'],
    ['a{1,2}{3}', 'repeats a repetition operator'],
    ['|a', 'empty alternation branch'],
    ['a|', 'empty alternation branch'],
    ['a||b', 'empty alternation branch'],
    ['(|a)', 'empty alternation branch'],
  ])('rejects %j, which does not compile as ERE', (pattern, expected) => {
    expect(ereIssue(pattern)).toContain(expected);
  });

  it.each([
    ['\\d+', '[[:digit:]]'],
    ['\\D', '[^[:digit:]]'],
    ['\\w+', '[[:alnum:]_]'],
    ['^\\s*$', '[[:space:]]'],
    ['\\bword\\b', 'word boundaries'],
    ['\\<word\\>', 'word boundaries'],
    ['\\p{L}', 'Unicode property'],
    ['\\Astart', 'use ^'],
    ['end\\z', 'use $'],
  ])('rejects %j, a JS idiom that compiles to something else', (pattern, remedy) => {
    const issue = ereIssue(pattern);
    expect(issue).toContain('Perl/JavaScript escape');
    expect(issue).toContain(remedy);
  });

  it.each([
    ['(?!x)', 'group syntax'],
    ['(?:a)', 'group syntax'],
    ['(?=x)', 'group syntax'],
    ['a+?', 'non-greedy'],
    ['a*?', 'non-greedy'],
  ])('rejects %j, a Perl/JS extension', (pattern, expected) => {
    expect(ereIssue(pattern)).toContain(expected);
  });

  it('accepts escaped ERE metacharacters', () => {
    for (const pattern of ['\\.', '\\(', '\\)', '\\[', '\\{', '\\}', '\\+', '\\*', '\\?', '\\|', '\\\\']) {
      expect(ereIssue(pattern), pattern).toBeNull();
    }
  });
});
