import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SERVER_VERSION } from '../../src/version.js';

describe('SERVER_VERSION', () => {
  it('matches the version in package.json', async () => {
    const raw = await readFile(join(import.meta.dirname, '../../package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
