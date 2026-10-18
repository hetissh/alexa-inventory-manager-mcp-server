import { afterEach, describe, expect, it, vi } from 'vitest';

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.doUnmock('../../src/cli/db.js');
});

describe('db CLI entrypoint', () => {
  it('runs the command from argv, prints through stdout and sets the exit code', async () => {
    const runDbCli = vi.fn((_args: readonly string[], deps: { write: (line: string) => void }) => {
      deps.write('hello from the cli');
      return Promise.resolve(3);
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.resetModules();
    vi.doMock('../../src/cli/db.js', () => ({ runDbCli }));
    process.argv = ['node', 'dbBin.ts', 'migrate'];

    await import('../../src/cli/dbBin.js');

    await vi.waitFor(() => {
      expect(process.exitCode).toBe(3);
    });
    expect(runDbCli).toHaveBeenCalledExactlyOnceWith(
      ['migrate'],
      expect.objectContaining({ env: process.env, write: expect.any(Function) as unknown }),
    );
    expect(stdout).toHaveBeenCalledWith('hello from the cli\n');
  });
});
