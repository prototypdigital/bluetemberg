import { describe, it, expect } from 'vitest';
import { injectManagedBlock, stripManagedBlock, AGENTS_RULES_MARKERS } from '../src/sync/managed-block.js';

const M = AGENTS_RULES_MARKERS;

describe('injectManagedBlock', () => {
  it('creates the block in a missing (null) file', () => {
    expect(injectManagedBlock(null, 'hello', M)).toBe(`${M.begin}\nhello\n${M.end}\n`);
  });

  it('returns empty for a missing file with empty inner', () => {
    expect(injectManagedBlock(null, '   ', M)).toBe('');
  });

  it('appends the block to existing content, preserving it and ordering it last', () => {
    const out = injectManagedBlock('# Hand authored\n\nbody', 'GEN', M);
    expect(out).toContain('# Hand authored');
    expect(out).toContain(`${M.begin}\nGEN\n${M.end}`);
    expect(out.indexOf('# Hand authored')).toBeLessThan(out.indexOf(M.begin));
  });

  it('replaces an existing block, leaving outer content intact', () => {
    const first = injectManagedBlock('HEAD', 'v1', M);
    const second = injectManagedBlock(first, 'v2', M);
    expect(second).toContain('HEAD');
    expect(second).toContain('v2');
    expect(second).not.toContain('v1');
  });

  it('is idempotent', () => {
    const first = injectManagedBlock('HEAD\n', 'body line', M);
    const second = injectManagedBlock(first, 'body line', M);
    expect(second).toBe(first);
  });

  it('removes the block when inner becomes empty, keeping outer content', () => {
    const withBlock = injectManagedBlock('HEAD', 'body', M);
    const removed = injectManagedBlock(withBlock, '', M);
    expect(removed).toBe('HEAD\n');
    expect(removed).not.toContain(M.begin);
  });

  it('leaves a blockless file untouched when inner is empty', () => {
    expect(injectManagedBlock('just content\n', '', M)).toBe('just content\n');
  });
});

describe('stripManagedBlock', () => {
  it('removes the fenced region, preserving outer content', () => {
    const withBlock = injectManagedBlock('HEAD', 'body', M);
    expect(stripManagedBlock(withBlock, M)).toBe('HEAD\n');
  });

  it('is a no-op when markers are absent', () => {
    expect(stripManagedBlock('no markers here\n', M)).toBe('no markers here\n');
  });
});
