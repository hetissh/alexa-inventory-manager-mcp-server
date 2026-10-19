import { describe, expect, it } from 'vitest';

import { SheetsError } from '../../src/app/errors.js';
import { ACTIVITY_HEADER, RESOURCES_HEADER } from '../../src/app/sheetRows.js';
import type { SheetRow } from '../../src/app/syncPorts.js';
import {
  ACTIVITY_TAB,
  classifyGoogleError,
  createGoogleSheetsGateway,
  RESOURCES_TAB,
  type SheetsApi,
} from '../../src/infra/sheets/googleGateway.js';

const ID = 'spreadsheet-id-1234567890abcdef';

/** A recording stand-in for the Google client. */
class FakeApi implements SheetsApi {
  readonly calls: string[] = [];
  titles: string[] = [];
  column: string[] = [];
  written: { range: string; values: readonly SheetRow[] }[] = [];
  appended: { range: string; values: readonly SheetRow[] }[] = [];
  failWith: unknown;
  failOn: string | undefined;

  private enter(name: string): void {
    this.calls.push(name);
    if (this.failOn === name) {
      throw this.failWith;
    }
  }

  getSheetTitles(): Promise<string[]> {
    this.enter('getSheetTitles');
    return Promise.resolve(this.titles);
  }

  addSheets(_id: string, titles: readonly string[]): Promise<void> {
    this.enter('addSheets');
    this.titles.push(...titles);
    return Promise.resolve();
  }

  writeValues(_id: string, range: string, values: readonly SheetRow[]): Promise<void> {
    this.enter('writeValues');
    this.written.push({ range, values });
    return Promise.resolve();
  }

  clearValues(_id: string, range: string): Promise<void> {
    this.enter(`clearValues ${range}`);
    return Promise.resolve();
  }

  readColumn(_id: string, range: string): Promise<string[]> {
    this.enter(`readColumn ${range}`);
    return Promise.resolve(this.column);
  }

  appendValues(_id: string, range: string, values: readonly SheetRow[]): Promise<void> {
    this.enter('appendValues');
    this.appended.push({ range, values });
    return Promise.resolve();
  }
}

describe('preparing the spreadsheet', () => {
  it('adds the missing tabs and writes their headers', async () => {
    const api = new FakeApi();
    api.titles = ['Sheet1'];

    await createGoogleSheetsGateway(api).prepare(ID);

    expect(api.titles).toEqual(['Sheet1', RESOURCES_TAB, ACTIVITY_TAB]);
    expect(api.written).toEqual([
      { range: 'Resources!A1', values: [RESOURCES_HEADER] },
      { range: 'Activity!A1', values: [ACTIVITY_HEADER] },
    ]);
  });

  it('only adds a tab that is missing, and leaves existing tabs and their contents alone', async () => {
    const api = new FakeApi();
    api.titles = [RESOURCES_TAB];

    await createGoogleSheetsGateway(api).prepare(ID);

    expect(api.titles).toEqual([RESOURCES_TAB, ACTIVITY_TAB]);
    expect(api.written).toEqual([{ range: 'Activity!A1', values: [ACTIVITY_HEADER] }]);
  });

  it('does nothing when both tabs already exist, and does not look again once it knows', async () => {
    const api = new FakeApi();
    api.titles = [RESOURCES_TAB, ACTIVITY_TAB];
    const gateway = createGoogleSheetsGateway(api);

    await gateway.prepare(ID);
    await gateway.prepare(ID);

    expect(api.calls).toEqual(['getSheetTitles']);
    expect(api.written).toEqual([]);
  });

  it('forgets what it knew after a failure, so the next attempt checks again', async () => {
    const api = new FakeApi();
    api.titles = [RESOURCES_TAB, ACTIVITY_TAB];
    const gateway = createGoogleSheetsGateway(api);
    await gateway.prepare(ID);

    api.failOn = 'readColumn Activity!A2:A';
    api.failWith = Object.assign(new Error('boom'), { status: 500 });
    await expect(gateway.listActivityEventIds(ID)).rejects.toBeInstanceOf(SheetsError);
    api.failOn = undefined;
    await gateway.prepare(ID);

    expect(api.calls.filter((call) => call === 'getSheetTitles')).toHaveLength(2);
  });

  it('turns a failure into a classified error and does not remember the sheet as ready', async () => {
    const api = new FakeApi();
    api.failOn = 'getSheetTitles';
    api.failWith = Object.assign(new Error('forbidden'), { status: 403 });
    const gateway = createGoogleSheetsGateway(api);

    await expect(gateway.prepare(ID)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('Editor') as string });
    api.failOn = undefined;
    api.titles = [RESOURCES_TAB, ACTIVITY_TAB];
    await expect(gateway.prepare(ID)).resolves.toBeUndefined();
  });
});

describe('writing the Resources tab', () => {
  it('writes the header and rows, then clears whatever is left below them', async () => {
    const api = new FakeApi();
    const rows: SheetRow[] = [['a', 1], ['b', 2]];

    await createGoogleSheetsGateway(api).replaceResources(ID, rows);

    expect(api.written).toEqual([{ range: 'Resources!A1', values: [RESOURCES_HEADER, ...rows] }]);
    expect(api.calls).toEqual(['writeValues', 'clearValues Resources!A4:I']);
  });

  it('clears from row 2 when there are no resources at all', async () => {
    const api = new FakeApi();

    await createGoogleSheetsGateway(api).replaceResources(ID, []);

    expect(api.calls).toEqual(['writeValues', 'clearValues Resources!A2:I']);
  });

  it('reports a failure to write as a classified error', async () => {
    const api = new FakeApi();
    api.failOn = 'writeValues';
    api.failWith = Object.assign(new Error('exceeds grid limits'), { status: 400 });

    await expect(createGoogleSheetsGateway(api).replaceResources(ID, [])).rejects.toMatchObject({
      retryable: false,
      message: 'Google rejected the request: exceeds grid limits',
    });
  });
});

describe('the Activity tab', () => {
  it('lists the event ids already there', async () => {
    const api = new FakeApi();
    api.column = ['event-1', 'event-2'];

    expect(await createGoogleSheetsGateway(api).listActivityEventIds(ID)).toEqual(new Set(['event-1', 'event-2']));
    expect(api.calls).toEqual(['readColumn Activity!A2:A']);
  });

  it('appends rows below the existing ones', async () => {
    const api = new FakeApi();
    const rows: SheetRow[] = [['event-3', 'x']];

    await createGoogleSheetsGateway(api).appendActivity(ID, rows);

    expect(api.appended).toEqual([{ range: 'Activity!A1', values: rows }]);
  });

  it('reports a failure to append as a classified error', async () => {
    const api = new FakeApi();
    api.failOn = 'appendValues';
    api.failWith = Object.assign(new Error('unavailable'), { code: 503 });

    await expect(createGoogleSheetsGateway(api).appendActivity(ID, [])).rejects.toMatchObject({ retryable: true });
  });
});

describe('classifyGoogleError', () => {
  const classify = (error: unknown): { retryable: boolean; message: string } => {
    const result = classifyGoogleError(error);
    return { retryable: result.retryable, message: result.message };
  };

  it.each([
    [401, false, 'Google rejected the credentials. Check the service-account key file.'],
    [403, false, 'Google denied access to the spreadsheet. Share it with the service account as an Editor.'],
    [404, false, 'The spreadsheet was not found. Check its id and that it still exists.'],
    [400, false, 'Google rejected the request: details'],
    [429, true, 'details'],
    [408, true, 'details'],
    [500, true, 'details'],
    [503, true, 'details'],
  ])('HTTP %i: retryable=%s', (status, retryable, message) => {
    expect(classify(Object.assign(new Error('details'), { status }))).toEqual({ retryable, message });
  });

  it('reads the status from `code` too, as the Google client reports it', () => {
    expect(classify(Object.assign(new Error('details'), { code: 404 })).retryable).toBe(false);
  });

  it('treats a 403 about rate limits or quota as worth retrying', () => {
    expect(classify(Object.assign(new Error('Quota exceeded for quota metric'), { status: 403 }))).toEqual({
      retryable: true,
      message: 'Google is limiting requests: Quota exceeded for quota metric',
    });
    expect(classify(Object.assign(new Error('User Rate Limit Exceeded'), { code: 403 })).retryable).toBe(true);
  });

  it('treats an error with no HTTP status (a dropped connection) as worth retrying', () => {
    expect(classify(new Error('socket hang up'))).toEqual({ retryable: true, message: 'socket hang up' });
    expect(classify('plain string')).toEqual({ retryable: true, message: 'plain string' });
  });

  it('tells the user how to fix missing credentials, and does not retry', () => {
    expect(classify(new Error('Could not load the default credentials.'))).toEqual({
      retryable: false,
      message: 'Google credentials are not set up: point GOOGLE_APPLICATION_CREDENTIALS at the service-account key file.',
    });
  });

  it('keeps an error that is already classified', () => {
    const original = new SheetsError('already classified', false);
    expect(classifyGoogleError(original)).toBe(original);
  });

  it('remembers the original error as the cause', () => {
    const cause = Object.assign(new Error('boom'), { status: 500 });
    expect(classifyGoogleError(cause).cause).toBe(cause);
  });
});
