import { describe, it, expect } from 'vitest';
import { verifyIntegrity } from '../src/registry/client.js';

describe('verifyIntegrity', () => {
  it('returns true when hashes match', () => {
    expect(verifyIntegrity('sha512-abc123', 'sha512-abc123')).toBe(true);
  });

  it('returns false when hashes differ', () => {
    expect(verifyIntegrity('sha512-abc123', 'sha512-xyz789')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(verifyIntegrity('', 'sha512-abc123')).toBe(false);
  });
});
