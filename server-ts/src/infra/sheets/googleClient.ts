import { auth, sheets } from '@googleapis/sheets';

import type { SheetsApi } from './googleGateway.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * The real Google Sheets client. Credentials come from Application Default Credentials: normally the
 * service-account key file named by GOOGLE_APPLICATION_CREDENTIALS. Nothing secret is held or logged here.
 */
export function createGoogleSheetsApi(): SheetsApi {
  const client = sheets({ version: 'v4', auth: new auth.GoogleAuth({ scopes: [SHEETS_SCOPE] }) });
  return {
    async getSheetTitles(spreadsheetId) {
      const response = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      return (response.data.sheets ?? []).flatMap((sheet) => sheet.properties?.title ?? []);
    },

    async addSheets(spreadsheetId, titles) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    },

    async writeValues(spreadsheetId, range, values) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: values.map((row) => [...row]) },
      });
    },

    async clearValues(spreadsheetId, range) {
      await client.spreadsheets.values.clear({ spreadsheetId, range });
    },

    async readColumn(spreadsheetId, range) {
      const response = await client.spreadsheets.values.get({ spreadsheetId, range, majorDimension: 'COLUMNS' });
      return ((response.data.values ?? [])[0] ?? []).map(String);
    },

    async appendValues(spreadsheetId, range, values) {
      await client.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: values.map((row) => [...row]) },
      });
    },
  };
}
