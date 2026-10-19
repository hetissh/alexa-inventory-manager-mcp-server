import { describe, expect, it } from 'vitest';

import { SheetsError } from '../../src/app/errors.js';
import { parseSpreadsheetId, runSheetsCli, SHEETS_USAGE } from '../../src/cli/sheets.js';
import { createTestPool, TEST_DATABASE_URL, WORKSPACE_ID } from '../helpers/db.js';
import { useCommandHarness } from '../helpers/service.js';
import { FakeSheetsGateway, SPREADSHEET_ID } from '../helpers/sync.js';

const harness = useCommandHarness();

async function run(args: string[], gateway = new FakeSheetsGateway(), env: NodeJS.ProcessEnv = {}): Promise<{ code: number; lines: string[]; gateway: FakeSheetsGateway }> {
  const lines: string[] = [];
  const code = await runSheetsCli(args, {
    env: { DATABASE_URL: TEST_DATABASE_URL, ...env },
    write: (line) => lines.push(line),
    gateway,
  });
  return { code, lines, gateway };
}

async function connected(): Promise<string | undefined> {
  const pool = createTestPool();
  try {
    const result = await pool.query<{ id: string | null }>(
      `SELECT integrations -> 'sheets' ->> 'spreadsheetId' AS id FROM workspaces WHERE id = $1`,
      [WORKSPACE_ID],
    );
    return result.rows[0]?.id ?? undefined;
  } finally {
    await pool.end();
  }
}

describe('parseSpreadsheetId', () => {
  it.each([
    [SPREADSHEET_ID, SPREADSHEET_ID],
    [`  ${SPREADSHEET_ID}\n`, SPREADSHEET_ID],
    [`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=0`, SPREADSHEET_ID],
    [`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`, SPREADSHEET_ID],
  ])('accepts %j', (input, expected) => {
    expect(parseSpreadsheetId(input)).toBe(expected);
  });

  it.each(['', 'short', 'has spaces in it that is long enough to pass', 'https://example.com/not-a-sheet', 'x'.repeat(101)])(
    'rejects %j',
    (input) => {
      expect(parseSpreadsheetId(input)).toBeUndefined();
    },
  );
});

describe('sheets CLI', () => {
  it('prints usage for a missing or unknown command', async () => {
    harness();
    for (const args of [[], ['explode', WORKSPACE_ID]]) {
      expect(await run(args)).toMatchObject({ code: 2, lines: [SHEETS_USAGE] });
    }
  });

  it('needs a workspace id', async () => {
    harness();
    const result = await run(['connect']);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toMatch(/give a workspace id first/);
    expect((await run(['connect', 'Not A Slug'])).code).toBe(2);
  });

  it('connects: proves access, creates the tabs, writes the current state, then starts syncing', async () => {
    harness();
    const { code, lines, gateway } = await run(['connect', WORKSPACE_ID, SPREADSHEET_ID]);

    expect(code).toBe(0);
    expect(gateway.calls).toEqual(['prepare', 'replaceResources']);
    expect(gateway.resources.map((row) => row[0])).toContain('item_air_filter');
    expect(lines).toEqual([expect.stringContaining(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`)]);
    expect(await connected()).toBe(SPREADSHEET_ID);
  });

  it('accepts the sheet\'s URL instead of its id', async () => {
    harness();
    await run(['connect', WORKSPACE_ID, `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`]);
    expect(await connected()).toBe(SPREADSHEET_ID);
  });

  it('does not connect when the spreadsheet cannot be reached, and says how to fix it', async () => {
    harness();
    const gateway = new FakeSheetsGateway();
    gateway.failNext('prepare', new SheetsError('Google denied access to the spreadsheet. Share it with the service account as an Editor.', false));

    const result = await run(['connect', WORKSPACE_ID, SPREADSHEET_ID], gateway);

    expect(result.code).toBe(1);
    expect(result.lines).toEqual(['sheets connect failed: Google denied access to the spreadsheet. Share it with the service account as an Editor.']);
    expect(await connected()).toBeUndefined();
  });

  it.each([
    ['a spreadsheet id that is not one', ['connect', WORKSPACE_ID, 'nope'], /Give the spreadsheet id/],
    ['no spreadsheet id', ['connect', WORKSPACE_ID], /Give the spreadsheet id/],
    ['a workspace that does not exist', ['connect', 'no-such-workspace', SPREADSHEET_ID], /was not found/],
    ['checking an unconnected workspace', ['check', WORKSPACE_ID], /not connected to a spreadsheet/],
  ])('refuses %s', async (_label, args, message) => {
    harness();
    const result = await run(args);
    expect(result.code).toBe(1);
    expect(result.lines[0]).toMatch(message);
  });

  it('checks that a connected spreadsheet can still be reached', async () => {
    harness();
    await run(['connect', WORKSPACE_ID, SPREADSHEET_ID]);

    const ok = await run(['check', WORKSPACE_ID]);
    expect(ok.code).toBe(0);
    expect(ok.lines[0]).toContain('reachable and writable');

    const broken = new FakeSheetsGateway();
    broken.failNext('prepare', new SheetsError('The spreadsheet was not found.', false));
    expect(await run(['check', WORKSPACE_ID], broken)).toMatchObject({ code: 1, lines: ['sheets check failed: The spreadsheet was not found.'] });
  });

  it('disconnects', async () => {
    harness();
    await run(['connect', WORKSPACE_ID, SPREADSHEET_ID]);

    const result = await run(['disconnect', WORKSPACE_ID]);

    expect(result).toMatchObject({ code: 0, lines: [`Workspace ${WORKSPACE_ID} is no longer connected to a spreadsheet.`] });
    expect(await connected()).toBeUndefined();
  });

  it('reports an invalid configuration', async () => {
    harness();
    const result = await run(['connect', WORKSPACE_ID, SPREADSHEET_ID], new FakeSheetsGateway(), { LOG_LEVEL: 'loud' });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toMatch(/Invalid configuration/);
  });
});
