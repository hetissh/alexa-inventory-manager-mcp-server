import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBin(startWorker: () => Promise<{ finished: Promise<void> }>): Promise<{ startWorker: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  const start = vi.fn(startWorker);
  vi.doMock('../../src/worker/main.js', () => ({ startWorker: start }));
  vi.doMock('../../src/logger.js', () => ({ createStderrDestination: () => ({ write: vi.fn() }) }));
  vi.doMock('../../src/infra/sheets/googleClient.js', () => ({ createGoogleSheetsApi: () => ({ marker: 'api' }) }));
  vi.doMock('../../src/infra/sheets/googleGateway.js', () => ({
    createGoogleSheetsGateway: (api: unknown) => ({ marker: 'gateway', api }),
  }));
  await import('../../src/worker/bin.js');
  return { startWorker: start };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const module of ['worker/main', 'logger', 'infra/sheets/googleClient', 'infra/sheets/googleGateway']) {
    vi.doUnmock(`../../src/${module}.js`);
  }
});

describe('worker entrypoint', () => {
  it('starts the worker with the real process and the Google gateway, and exits 0 once it has stopped', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { startWorker } = await loadBin(() => Promise.resolve({ finished: Promise.resolve() }));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    });
    expect(startWorker).toHaveBeenCalledExactlyOnceWith({
      env: process.env,
      logDestination: expect.anything() as unknown,
      proc: process,
      gateway: { marker: 'gateway', api: { marker: 'api' } },
    });
  });

  it('reports a startup failure on stderr and exits 1', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await loadBin(() => Promise.reject(new Error('no database')));

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
    expect(write).toHaveBeenCalledWith('voiceops-worker failed: no database\n');
  });
});
