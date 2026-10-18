import { Console } from 'node:console';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { installStdoutGuard } from '../../src/stdout-guard.js';

function createTestConsole(): { target: Console; stdout: PassThrough; stderr: PassThrough } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return { target: new Console({ stdout, stderr }), stdout, stderr };
}

describe('installStdoutGuard', () => {
  it('redirects log, info and debug to stderr', () => {
    const { target, stdout, stderr } = createTestConsole();
    installStdoutGuard(target);
    target.log('a log');
    target.info('an info');
    target.debug('a debug');
    expect(stdout.read()).toBeNull();
    expect(String(stderr.read())).toBe('a log\nan info\na debug\n');
  });

  it('restores the original console methods', () => {
    const { target, stdout } = createTestConsole();
    const restore = installStdoutGuard(target);
    restore();
    target.log('back on stdout');
    expect(String(stdout.read())).toBe('back on stdout\n');
  });
});
