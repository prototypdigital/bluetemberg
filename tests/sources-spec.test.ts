import { describe, it, expect } from 'vitest';
import { parseSourceSpec, sourceKey } from '../src/sources/spec.js';

describe('parseSourceSpec — github', () => {
  it('parses owner/repo with default ref and empty path', () => {
    expect(parseSourceSpec('github:PatrickJS/awesome-cursorrules')).toEqual({
      type: 'github',
      owner: 'PatrickJS',
      repo: 'awesome-cursorrules',
      ref: 'HEAD',
      path: '',
    });
  });

  it('parses ref and path', () => {
    expect(parseSourceSpec('github:owner/repo#main:rules')).toEqual({
      type: 'github',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: 'rules',
    });
  });

  it('parses a path without a ref', () => {
    expect(parseSourceSpec('github:owner/repo:rules/nested')).toMatchObject({
      ref: 'HEAD',
      path: 'rules/nested',
    });
  });

  it('strips leading/trailing slashes from path', () => {
    expect(parseSourceSpec('github:owner/repo:/rules/')).toMatchObject({ path: 'rules' });
  });

  it('rejects a missing repo', () => {
    expect(() => parseSourceSpec('github:owneronly')).toThrow('expected "github:owner/repo');
  });

  it('rejects ".." path traversal', () => {
    expect(() => parseSourceSpec('github:owner/repo:../etc')).toThrow('must not contain ".."');
  });

  it('rejects an empty ref after "#"', () => {
    expect(() => parseSourceSpec('github:owner/repo#:rules')).toThrow('ref cannot be empty');
  });
});

describe('parseSourceSpec — prpm', () => {
  it('defaults range to latest', () => {
    expect(parseSourceSpec('prpm:my-rules')).toEqual({ type: 'prpm', name: 'my-rules', range: 'latest' });
  });

  it('parses an explicit range', () => {
    expect(parseSourceSpec('prpm:my-rules@^1.2.0')).toEqual({
      type: 'prpm',
      name: 'my-rules',
      range: '^1.2.0',
    });
  });

  it('parses a scoped name with range', () => {
    expect(parseSourceSpec('prpm:@obra/skill-x@1.0.0')).toEqual({
      type: 'prpm',
      name: '@obra/skill-x',
      range: '1.0.0',
    });
  });

  it('parses a scoped name without range', () => {
    expect(parseSourceSpec('prpm:@obra/skill-x')).toEqual({
      type: 'prpm',
      name: '@obra/skill-x',
      range: 'latest',
    });
  });

  it('rejects a name with ".." traversal', () => {
    expect(() => parseSourceSpec('prpm:../evil')).toThrow('name must be a package name');
  });

  it('rejects a name with illegal characters', () => {
    expect(() => parseSourceSpec('prpm:foo bar')).toThrow('name must be a package name');
  });
});

describe('parseSourceSpec — cursor-directory', () => {
  it('parses a slug', () => {
    expect(parseSourceSpec('cursor-directory:nextjs-react')).toEqual({
      type: 'cursor-directory',
      slug: 'nextjs-react',
    });
  });

  it('parses the wildcard', () => {
    expect(parseSourceSpec('cursor-directory:*')).toEqual({ type: 'cursor-directory', slug: '*' });
  });
});

describe('parseSourceSpec — errors', () => {
  it('rejects a missing type prefix', () => {
    expect(() => parseSourceSpec('owner/repo')).toThrow('expected "<type>:<...>"');
  });

  it('rejects an unknown type', () => {
    expect(() => parseSourceSpec('gitlab:owner/repo')).toThrow('unknown type "gitlab"');
  });
});

describe('sourceKey', () => {
  it('keys github by owner/repo[:path], excluding the floating ref', () => {
    expect(sourceKey(parseSourceSpec('github:owner/repo#main:rules'))).toBe('github:owner/repo:rules');
    expect(sourceKey(parseSourceSpec('github:owner/repo#v2'))).toBe('github:owner/repo');
  });

  it('keys prpm by name, excluding the range', () => {
    expect(sourceKey(parseSourceSpec('prpm:my-rules@^1.0.0'))).toBe('prpm:my-rules');
  });

  it('keys cursor-directory by slug', () => {
    expect(sourceKey(parseSourceSpec('cursor-directory:nextjs'))).toBe('cursor-directory:nextjs');
  });
});
