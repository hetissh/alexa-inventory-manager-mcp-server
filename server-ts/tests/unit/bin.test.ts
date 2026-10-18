import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBin(mainImpl: () => Promise<unknown>): Promise<{
  main: ReturnType<typeof vi.fn>;
  installStdoutGuard: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const main = vi.fn(mainImpl);
  const installStdoutGuard = vi.fn();
  vi.doMock('../../src/main.js', () => ({ main }));
  vi.doMock('../../src/stdout-guard.js', () => ({ installStdoutGuard }));
  vi.doMock('../../src/logger.js', () => ({ createStderrDestination: () => ({ write: vi.fn() }) }));
  await import('../../src/bin.js');
  return { main, installStdoutGuard };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../src/main.js');
  vi.doUnmock('../../src/stdout-guard.js');
  vi.doUnmock('../../src/logger.js');
});

describe('bin entrypoint', () => {
  it('installs the stdout guard and starts the server with the real process streams', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { main, installStdoutGuard } = await loadBin(() => Promise.resolve());

    expect(installStdoutGuard).toHaveBeenCalledExactlyOnceWith(console);
    expect(main).toHaveBeenCalledExactlyOnceWith({
      env: process.env,
      stdin: process.stdin,
      stdout: process.stdout,
      logDestination: expect.anything() as unknown,
      proc: process,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('reports a startup Error on stderr and exits 1', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await loadBin(() => Promise.reject(new Error('boom')));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
    expect(write).toHaveBeenCalledWith('voiceops-mcp failed to start: boom\n');
  });

  it('reports a non-Error startup failure on stderr and exits 1', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately testing a non-Error rejection
    await loadBin(() => Promise.reject('plain failure'));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
    expect(write).toHaveBeenCalledWith('voiceops-mcp failed to start: plain failure\n');
  });
});
