import { SheetsError } from '../../app/errors.js';
import { ACTIVITY_HEADER, RESOURCES_HEADER } from '../../app/sheetRows.js';
import type { SheetRow, SheetsGateway } from '../../app/syncPorts.js';
import { errorMessage } from '../../errorMessage.js';

export const RESOURCES_TAB = 'Resources';
export const ACTIVITY_TAB = 'Activity';

/** The handful of spreadsheet operations the gateway needs, so the logic below can be tested without Google. */
export interface SheetsApi {
  getSheetTitles(spreadsheetId: string): Promise<string[]>;
  addSheets(spreadsheetId: string, titles: readonly string[]): Promise<void>;
  /** Writes values starting at `range`, stored exactly as given (never parsed as formulas). */
  writeValues(spreadsheetId: string, range: string, values: readonly SheetRow[]): Promise<void>;
  clearValues(spreadsheetId: string, range: string): Promise<void>;
  /** The cells of a single column as text. */
  readColumn(spreadsheetId: string, range: string): Promise<string[]>;
  /** Adds rows below the last row of the tab, stored exactly as given. */
  appendValues(spreadsheetId: string, range: string, values: readonly SheetRow[]): Promise<void>;
}

/** The HTTP status carried by an error from the Google client, if any. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }
  if ('code' in error && typeof error.code === 'number') {
    return error.code;
  }
  return undefined;
}

/**
 * Sorts a failure into "worth trying again later" (rate limits, outages, network trouble) and
 * "will keep failing until a person fixes something" (no access, wrong id, bad credentials), with a message
 * that says what to fix. Messages never contain credentials.
 */
export function classifyGoogleError(error: unknown): SheetsError {
  if (error instanceof SheetsError) {
    return error;
  }
  const status = httpStatus(error);
  const detail = errorMessage(error);
  const options = { cause: error };
  if (status === undefined && /default credentials|credential/i.test(detail)) {
    return new SheetsError(
      'Google credentials are not set up: point GOOGLE_APPLICATION_CREDENTIALS at the service-account key file.',
      false,
      options,
    );
  }
  switch (status) {
    case 401:
      return new SheetsError('Google rejected the credentials. Check the service-account key file.', false, options);
    case 403:
      return /rate limit|quota/i.test(detail)
        ? new SheetsError(`Google is limiting requests: ${detail}`, true, options)
        : new SheetsError(
            'Google denied access to the spreadsheet. Share it with the service account as an Editor.',
            false,
            options,
          );
    case 404:
      return new SheetsError('The spreadsheet was not found. Check its id and that it still exists.', false, options);
    case 400:
      return new SheetsError(`Google rejected the request: ${detail}`, false, options);
    default:
      // 408, 429, 5xx and errors without a status (a dropped connection) can all clear up by themselves.
      return new SheetsError(detail, true, options);
  }
}

/** Resources and Activity tabs in a Google Sheet. Values are written RAW, so a name like "=1+1" stays text. */
export function createGoogleSheetsGateway(api: SheetsApi): SheetsGateway {
  const prepared = new Set<string>();

  /** Runs one step, turning any failure into a classified SheetsError and forgetting what we knew about the sheet. */
  async function step<T>(spreadsheetId: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      prepared.delete(spreadsheetId);
      throw classifyGoogleError(error);
    }
  }

  return {
    async prepare(spreadsheetId) {
      if (prepared.has(spreadsheetId)) {
        return;
      }
      await step(spreadsheetId, async () => {
        const titles = await api.getSheetTitles(spreadsheetId);
        const missing = [RESOURCES_TAB, ACTIVITY_TAB].filter((tab) => !titles.includes(tab));
        if (missing.length === 0) {
          return;
        }
        await api.addSheets(spreadsheetId, missing);
        for (const tab of missing) {
          const header = tab === RESOURCES_TAB ? RESOURCES_HEADER : ACTIVITY_HEADER;
          await api.writeValues(spreadsheetId, `${tab}!A1`, [header]);
        }
      });
      prepared.add(spreadsheetId);
    },

    async replaceResources(spreadsheetId, rows) {
      await step(spreadsheetId, async () => {
        await api.writeValues(spreadsheetId, `${RESOURCES_TAB}!A1`, [RESOURCES_HEADER, ...rows]);
        // Rows that used to be there but are not any more (header is row 1, data starts at row 2).
        await api.clearValues(spreadsheetId, `${RESOURCES_TAB}!A${String(rows.length + 2)}:I`);
      });
    },

    async listActivityEventIds(spreadsheetId) {
      return step(spreadsheetId, async () => new Set(await api.readColumn(spreadsheetId, `${ACTIVITY_TAB}!A2:A`)));
    },

    async appendActivity(spreadsheetId, rows) {
      await step(spreadsheetId, () => api.appendValues(spreadsheetId, `${ACTIVITY_TAB}!A1`, rows));
    },
  };
}
