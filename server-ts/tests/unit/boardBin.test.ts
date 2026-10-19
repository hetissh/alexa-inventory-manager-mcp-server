import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBin(startBoardServer: () => Promise<{ finished: Promise<void> }>): Promise<{ startBoardServer: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  const start = vi.fn(startBoardServer);
  vi.doMock('../../src/http/main.js', () => ({ startBoardServer: start }));
  vi.doMock('../../src/logger.js', () => ({ createStderrDestination: () => ({ write: vi.fn() }) }));
  await import('../../src/http/bin.js');
  return { startBoardServer: start };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const module of ['http/main', 'logger']) {
    vi.doUnmock(`../../src/${module}.js`);
  }
});

describe('board entrypoint', () => {
  it('starts the board server with the real process, and exits 0 once it has stopped', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { startBoardServer } = await loadBin(() => Promise.resolve({ finished: Promise.resolve() }));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    });
    expect(startBoardServer).toHaveBeenCalledExactlyOnceWith({
      env: process.env,
      logDestination: expect.anything() as unknown,
      proc: process,
    });
  });

  it('reports a startup failure on stderr and exits 1', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await loadBin(() => Promise.reject(new Error('port already in use')));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
    expect(write).toHaveBeenCalledWith('voiceops-board failed: port already in use\n');
  });
});
