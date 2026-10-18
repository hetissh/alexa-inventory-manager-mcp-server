import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults the log level to info', () => {
    expect(loadConfig({})).toEqual({ logLevel: 'info' });
  });

  it('accepts a valid log level', () => {
    expect(loadConfig({ LOG_LEVEL: 'debug' })).toEqual({ logLevel: 'debug' });
  });

  it('throws a readable error for an invalid log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/Invalid configuration[\s\S]*LOG_LEVEL/);
  });
});
