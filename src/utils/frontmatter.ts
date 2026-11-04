import { readFileSync } from 'node:fs';
import matter from 'gray-matter';

/**
 * The single entry point for frontmatter parsing. Every call to gray-matter goes through here.
 *
 * gray-matter picks a parser from the text after the opening fence (`---yaml`, `---json`, ...),
 * and its defaults include engines that execute code. Pack, `extends` and external-source content
 * is untrusted, so only plain `---` (YAML) fences are accepted: any other fence language throws,
 * and the code engines are replaced with ones that throw, as a second line of defence.
 */

export type FrontmatterFile = matter.GrayMatterFile<string>;

/** Fence languages accepted after the opening `---`; the empty string is a plain fence. */
const ALLOWED_FENCE_LANGUAGES: ReadonlySet<string> = new Set(['', 'yaml', 'yml']);

const FENCE = '---';

export class UnsupportedFrontmatterError extends Error {
  constructor(language: string) {
    super(`Unsupported frontmatter fence "---${language}": only YAML frontmatter is allowed`);
    this.name = 'UnsupportedFrontmatterError';
  }
}

function refuseEngine(language: string): { parse: () => never; stringify: () => never } {
  const refuse = (): never => {
    throw new UnsupportedFrontmatterError(language);
  };
  return { parse: refuse, stringify: refuse };
}

/**
 * Passing options also bypasses gray-matter's module-level cache, which hands out shared mutable
 * objects keyed by content.
 */
const SAFE_OPTIONS = {
  language: 'yaml',
  engines: {
    javascript: refuseEngine('javascript'),
    js: refuseEngine('js'),
    coffee: refuseEngine('coffee'),
  },
} satisfies matter.GrayMatterOption<string, never>;

/**
 * The language gray-matter would read after the opening fence, lower-cased; `''` for a plain
 * fence or no frontmatter. Mirrors gray-matter's detection: a fence is `---` at offset 0 not
 * followed by another `-`.
 */
export function frontmatterFenceLanguage(content: string): string {
  if (!content.startsWith(FENCE)) return '';
  if (content.charAt(FENCE.length) === '-') return '';
  const lineEnd = content.search(/\r?\n/);
  const rest = lineEnd === -1 ? content.slice(FENCE.length) : content.slice(FENCE.length, lineEnd);
  return rest.trim().toLowerCase();
}

function assertSafeFence(content: string): void {
  const language = frontmatterFenceLanguage(content);
  if (ALLOWED_FENCE_LANGUAGES.has(language)) return;
  throw new UnsupportedFrontmatterError(language);
}

/** Parse frontmatter + body. Throws on malformed YAML or a non-YAML fence. */
export function parseFrontmatter(content: string): FrontmatterFile {
  assertSafeFence(content);
  return matter(content, SAFE_OPTIONS);
}

/** Read a file and parse its frontmatter. Throws on read errors, malformed YAML or a non-YAML fence. */
export function readFrontmatter(path: string): FrontmatterFile {
  return parseFrontmatter(readFileSync(path, 'utf8'));
}

/**
 * Serialize `data` as YAML frontmatter above `content`. Like gray-matter's `stringify`, a string
 * `content` is parsed first (a leading fence in it is merged), so it gets the same fence check.
 */
export function stringifyFrontmatter(content: string | FrontmatterFile, data: object): string {
  if (typeof content === 'string') assertSafeFence(content);
  return matter.stringify(content, data, SAFE_OPTIONS);
}
