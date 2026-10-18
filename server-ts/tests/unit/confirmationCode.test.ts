import { describe, expect, it } from 'vitest';

import { generateToken, hashToken, TOKEN_PATTERN } from '../../src/app/confirmationCode.js';

describe('confirmation tokens', () => {
  it('are 22 URL-safe characters and different every time', () => {
    const tokens = Array.from({ length: 50 }, () => generateToken());
    expect(tokens.every((token) => TOKEN_PATTERN.test(token))).toBe(true);
    expect(new Set(tokens).size).toBe(50);
  });

  it('are only ever stored as a stable SHA-256 hash that does not reveal the token', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashToken(generateToken())).not.toBe(hash);
  });

  it('the pattern rejects anything that is not a token', () => {
    for (const bad of ['', 'short', 'x'.repeat(23), 'has space has space ab', '../../etc/passwd/abcdef']) {
      expect(TOKEN_PATTERN.test(bad)).toBe(false);
    }
  });
});
