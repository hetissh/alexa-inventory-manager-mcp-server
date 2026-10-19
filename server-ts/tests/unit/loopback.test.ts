import { describe, expect, it } from 'vitest';

import { isLoopbackHost } from '../../src/loopback.js';

describe('isLoopbackHost', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])('%s only reaches this computer', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(['0.0.0.0', '192.168.1.20', 'example.com', '::', '', '127.0.0.2'])('%j is reachable from elsewhere (or unknown)', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
