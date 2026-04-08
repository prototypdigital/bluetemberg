import { describe, it, expect } from 'vitest';
import { transformFrontmatter } from '../src/sync/transform.js';

describe('transformFrontmatter', () => {
  describe('cursor', () => {
    it('sets alwaysApply for global scope', () => {
      const result = transformFrontmatter({ description: 'Test', scope: '**' }, 'cursor');
      expect(result).toEqual({ description: 'Test', alwaysApply: true });
    });

    it('sets alwaysApply when scope is omitted', () => {
      const result = transformFrontmatter({ description: 'Test' }, 'cursor');
      expect(result).toEqual({ description: 'Test', alwaysApply: true });
    });

    it('sets globs for file-scoped rules', () => {
      const result = transformFrontmatter({ description: 'Test', scope: 'src/**' }, 'cursor');
      expect(result).toEqual({ description: 'Test', globs: ['src/**'] });
    });

    it('wraps string scope in array for globs', () => {
      const result = transformFrontmatter({ description: 'Test', scope: 'lib/**' }, 'cursor');
      expect(result).toHaveProperty('globs', ['lib/**']);
    });

    it('passes array scope through for globs', () => {
      const result = transformFrontmatter({ description: 'Test', scope: ['src/**', 'lib/**'] }, 'cursor');
      expect(result).toHaveProperty('globs', ['src/**', 'lib/**']);
    });
  });

  describe('claude', () => {
    it('sets paths array for global scope', () => {
      const result = transformFrontmatter({ description: 'Test', scope: '**' }, 'claude');
      expect(result).toEqual({ description: 'Test', paths: ['**'] });
    });

    it('wraps string scope in array', () => {
      const result = transformFrontmatter({ description: 'Test', scope: 'src/**' }, 'claude');
      expect(result).toHaveProperty('paths', ['src/**']);
    });

    it('passes array scope through', () => {
      const result = transformFrontmatter({ description: 'Test', scope: ['a/**', 'b/**'] }, 'claude');
      expect(result).toHaveProperty('paths', ['a/**', 'b/**']);
    });
  });

  describe('copilot', () => {
    it('sets applyTo string for single scope', () => {
      const result = transformFrontmatter({ description: 'Test', scope: 'src/**' }, 'copilot');
      expect(result).toEqual({ description: 'Test', applyTo: 'src/**' });
    });

    it('joins array scope with comma', () => {
      const result = transformFrontmatter({ description: 'Test', scope: ['a/**', 'b/**'] }, 'copilot');
      expect(result).toHaveProperty('applyTo', 'a/**,b/**');
    });

    it('defaults scope to ** when omitted', () => {
      const result = transformFrontmatter({ description: 'Test' }, 'copilot');
      expect(result).toEqual({ description: 'Test', applyTo: '**' });
    });
  });

  describe('cursor — array scope edge case', () => {
    it('uses globs (not alwaysApply) when scope is ["**"] as array', () => {
      const result = transformFrontmatter({ description: 'Test', scope: ['**'] }, 'cursor');
      expect(result).toHaveProperty('globs', ['**']);
      expect(result).not.toHaveProperty('alwaysApply');
    });
  });

  describe('claude — omitted scope', () => {
    it('defaults scope to ** when omitted', () => {
      const result = transformFrontmatter({ description: 'Test' }, 'claude');
      expect(result).toEqual({ description: 'Test', paths: ['**'] });
    });
  });

  it('defaults description to empty string', () => {
    const result = transformFrontmatter({}, 'cursor');
    expect(result.description).toBe('');
  });

  it('throws for unknown platform', () => {
    // @ts-expect-error testing invalid platform
    expect(() => transformFrontmatter({}, 'unknown')).toThrow('Unknown platform: unknown');
  });
});
