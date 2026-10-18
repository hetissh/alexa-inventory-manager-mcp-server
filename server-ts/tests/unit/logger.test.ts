import { describe, expect, it } from 'vitest';

import { createLogger, createStderrDestination } from '../../src/logger.js';

function captureLogger(level: Parameters<typeof createLogger>[0]): {
  logger: ReturnType<typeof createLogger>;
  lines: () => Record<string, unknown>[];
} {
  const written: string[] = [];
  const logger = createLogger(level, {
    write: (message: string) => {
      written.push(message);
    },
  });
  return {
    logger,
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('writes JSON lines tagged with the server name', () => {
    const { logger, lines } = captureLogger('info');
    logger.info({ reason: 'test' }, 'hello');
    expect(lines()).toEqual([expect.objectContaining({ name: 'voiceops', msg: 'hello', reason: 'test' })]);
  });

  it('respects the configured level', () => {
    const { logger, lines } = captureLogger('warn');
    logger.info('hidden');
    logger.warn('shown');
    expect(lines().map((line) => line['msg'])).toEqual(['shown']);
  });

  it('redacts secret-looking keys at the top level and one level deep', () => {
    const { logger, lines } = captureLogger('info');
    logger.info({ token: 'abc', nested: { password: 'p', apiKey: 'k' }, safe: 'ok' }, 'secrets');
    expect(lines()[0]).toMatchObject({
      token: '[redacted]',
      nested: { password: '[redacted]', apiKey: '[redacted]' },
      safe: 'ok',
    });
  });
});

describe('createStderrDestination', () => {
  it('returns a writable destination', () => {
    expect(typeof createStderrDestination().write).toBe('function');
  });
});
