import { describe, expect, it } from 'vitest';

import { setSheetsIntegration } from '../../src/infra/db/integrations.js';
import { WORKSPACE_ID } from '../helpers/db.js';
import { useCommandHarness } from '../helpers/service.js';

const harness = useCommandHarness();

describe('setSheetsIntegration', () => {
  it('connects a workspace to a spreadsheet, replaces it, and disconnects it', async () => {
    const h = harness();
    const read = async (): Promise<unknown> => (await h.store.getWorkspace(WORKSPACE_ID))?.integrations;

    expect(await setSheetsIntegration(h.pool, WORKSPACE_ID, 'first-sheet-id-1234567890')).toBe(true);
    expect(await read()).toEqual({ sheets: { spreadsheetId: 'first-sheet-id-1234567890' } });

    expect(await setSheetsIntegration(h.pool, WORKSPACE_ID, 'second-sheet-id-123456789')).toBe(true);
    expect(await read()).toEqual({ sheets: { spreadsheetId: 'second-sheet-id-123456789' } });

    expect(await setSheetsIntegration(h.pool, WORKSPACE_ID, undefined)).toBe(true);
    expect(await read()).toEqual({});
  });

  it('says so when the workspace does not exist', async () => {
    expect(await setSheetsIntegration(harness().pool, 'no-such-workspace', 'some-sheet-id-1234567890')).toBe(false);
  });
});
