import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const spreadsheets = {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: { get: vi.fn(), update: vi.fn(), clear: vi.fn(), append: vi.fn() },
  };
  const authOptions: unknown[] = [];
  // A function expression (not an arrow) so it can be used with `new`.
  const GoogleAuth = vi.fn(function (options: unknown) {
    authOptions.push(options);
  });
  return { spreadsheets, authOptions, GoogleAuth, sheets: vi.fn(() => ({ spreadsheets })) };
});

vi.mock('@googleapis/sheets', () => ({ sheets: mocks.sheets, auth: { GoogleAuth: mocks.GoogleAuth } }));

import { createGoogleSheetsApi, SHEETS_SCOPE } from '../../src/infra/sheets/googleClient.js';

const ID = 'spreadsheet-id-1234567890abcdef';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authOptions.length = 0;
});

describe('the Google Sheets client', () => {
  it('asks only for the Sheets scope and takes credentials from the environment', () => {
    createGoogleSheetsApi();

    expect(mocks.authOptions).toEqual([{ scopes: [SHEETS_SCOPE] }]);
    expect(SHEETS_SCOPE).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(mocks.sheets).toHaveBeenCalledWith({ version: 'v4', auth: expect.anything() as unknown });
  });

  it('lists tab titles, skipping tabs without one and coping with an empty response', async () => {
    const api = createGoogleSheetsApi();
    mocks.spreadsheets.get.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: 'Resources' } }, { properties: {} }, {}] } });
    mocks.spreadsheets.get.mockResolvedValueOnce({ data: {} });

    expect(await api.getSheetTitles(ID)).toEqual(['Resources']);
    expect(await api.getSheetTitles(ID)).toEqual([]);
    expect(mocks.spreadsheets.get).toHaveBeenCalledWith({ spreadsheetId: ID, fields: 'sheets.properties.title' });
  });

  it('adds tabs by title', async () => {
    await createGoogleSheetsApi().addSheets(ID, ['Resources', 'Activity']);

    expect(mocks.spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Resources' } } }, { addSheet: { properties: { title: 'Activity' } } }] },
    });
  });

  it('writes values RAW, so nothing is ever interpreted as a formula', async () => {
    await createGoogleSheetsApi().writeValues(ID, 'Resources!A1', [['=1+1', 2]]);

    expect(mocks.spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: ID,
      range: 'Resources!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [['=1+1', 2]] },
    });
  });

  it('clears a range', async () => {
    await createGoogleSheetsApi().clearValues(ID, 'Resources!A4:I');

    expect(mocks.spreadsheets.values.clear).toHaveBeenCalledWith({ spreadsheetId: ID, range: 'Resources!A4:I' });
  });

  it('reads one column as text, and copes with an empty tab', async () => {
    const api = createGoogleSheetsApi();
    mocks.spreadsheets.values.get.mockResolvedValueOnce({ data: { values: [['event-1', 42]] } });
    mocks.spreadsheets.values.get.mockResolvedValueOnce({ data: {} });
    mocks.spreadsheets.values.get.mockResolvedValueOnce({ data: { values: [] } });

    expect(await api.readColumn(ID, 'Activity!A2:A')).toEqual(['event-1', '42']);
    expect(await api.readColumn(ID, 'Activity!A2:A')).toEqual([]);
    expect(await api.readColumn(ID, 'Activity!A2:A')).toEqual([]);
    expect(mocks.spreadsheets.values.get).toHaveBeenCalledWith({ spreadsheetId: ID, range: 'Activity!A2:A', majorDimension: 'COLUMNS' });
  });

  it('appends rows RAW below the last row', async () => {
    await createGoogleSheetsApi().appendValues(ID, 'Activity!A1', [['event-3', 'x']]);

    expect(mocks.spreadsheets.values.append).toHaveBeenCalledWith({
      spreadsheetId: ID,
      range: 'Activity!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [['event-3', 'x']] },
    });
  });
});
