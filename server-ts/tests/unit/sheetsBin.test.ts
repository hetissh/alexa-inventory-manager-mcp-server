import { afterEach, describe, expect, it, vi } from 'vitest';

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.doUnmock('../../src/cli/sheets.js');
  vi.doUnmock('../../src/infra/sheets/googleClient.js');
  vi.doUnmock('../../src/infra/sheets/googleGateway.js');
});

describe('sheets CLI entrypoint', () => {
  it('runs the command from argv with the Google gateway, prints through stdout and sets the exit code', async () => {
    const runSheetsCli = vi.fn((_args: readonly string[], deps: { write: (line: string) => void }) => {
      deps.write('connected');
      return Promise.resolve(4);
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.resetModules();
    vi.doMock('../../src/cli/sheets.js', () => ({ runSheetsCli }));
    vi.doMock('../../src/infra/sheets/googleClient.js', () => ({ createGoogleSheetsApi: () => ({ marker: 'api' }) }));
    vi.doMock('../../src/infra/sheets/googleGateway.js', () => ({
      createGoogleSheetsGateway: (api: unknown) => ({ marker: 'gateway', api }),
    }));
    process.argv = ['node', 'sheetsBin.ts', 'check', 'northside-warehouse'];

    await import('../../src/cli/sheetsBin.js');

    await vi.waitFor(() => {
      expect(process.exitCode).toBe(4);
    });
    expect(runSheetsCli).toHaveBeenCalledExactlyOnceWith(
      ['check', 'northside-warehouse'],
      expect.objectContaining({ env: process.env, gateway: { marker: 'gateway', api: { marker: 'api' } } }),
    );
    expect(stdout).toHaveBeenCalledWith('connected\n');
  });
});
