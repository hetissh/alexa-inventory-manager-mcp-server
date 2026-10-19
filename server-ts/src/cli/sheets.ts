import { z } from 'zod';

import type { SheetsGateway } from '../app/syncPorts.js';
import { writeSnapshot } from '../app/syncWorker.js';
import { loadConfig } from '../config.js';
import { workspaceIdSchema } from '../domain/schemas.js';
import { errorMessage } from '../errorMessage.js';
import { setSheetsIntegration } from '../infra/db/integrations.js';
import { createPgStore } from '../infra/db/pgStore.js';
import { createPool, poolErrorReporter } from '../infra/db/pool.js';

const COMMANDS = ['connect', 'disconnect', 'check'] as const;
type SheetsCommand = (typeof COMMANDS)[number];

export const SHEETS_USAGE = [
  'Usage: sheets <command> <workspace-id> [spreadsheet]',
  '  connect <workspace-id> <spreadsheet-id-or-url>   check access, create the tabs, write the current state, then start syncing changes',
  '  check <workspace-id>                              check the workspace\'s spreadsheet can still be reached and written',
  '  disconnect <workspace-id>                         stop syncing the workspace to a spreadsheet',
].join('\n');

export interface SheetsCliDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly write: (line: string) => void;
  /** Where spreadsheet updates are written (fake in tests, the real Google client in the program). */
  readonly gateway: SheetsGateway;
}

const spreadsheetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

/** Accepts a bare spreadsheet id or a full docs.google.com URL, and returns the id (or undefined if it is neither). */
export function parseSpreadsheetId(input: string): string | undefined {
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(input)?.[1];
  const parsed = spreadsheetIdSchema.safeParse(fromUrl ?? input.trim());
  return parsed.success ? parsed.data : undefined;
}

function isCommand(value: string | undefined): value is SheetsCommand {
  return COMMANDS.some((command) => command === value);
}

export async function runSheetsCli(args: readonly string[], deps: SheetsCliDeps): Promise<number> {
  const [command, workspaceArg, spreadsheetArg] = args;
  if (!isCommand(command)) {
    deps.write(SHEETS_USAGE);
    return 2;
  }
  const workspace = workspaceIdSchema.safeParse(workspaceArg);
  if (!workspace.success) {
    deps.write(`sheets ${command} failed: give a workspace id first (for example northside-warehouse).`);
    return 2;
  }
  const workspaceId = workspace.data;

  let pool: ReturnType<typeof createPool> | undefined;
  try {
    pool = createPool(loadConfig(deps.env).databaseUrl, poolErrorReporter(deps.write));
    const store = createPgStore(pool);
    const found = await store.getWorkspace(workspaceId);
    if (!found) {
      throw new Error(`Workspace "${workspaceId}" was not found.`);
    }

    if (command === 'disconnect') {
      await setSheetsIntegration(pool, workspaceId, undefined);
      deps.write(`Workspace ${workspaceId} is no longer connected to a spreadsheet.`);
      return 0;
    }

    if (command === 'check') {
      const connected = found.integrations.sheets?.spreadsheetId;
      if (connected === undefined) {
        throw new Error(`Workspace "${workspaceId}" is not connected to a spreadsheet.`);
      }
      await deps.gateway.prepare(connected);
      deps.write(`The spreadsheet for ${workspaceId} is reachable and writable: https://docs.google.com/spreadsheets/d/${connected}`);
      return 0;
    }

    const spreadsheetId = parseSpreadsheetId(spreadsheetArg ?? '');
    if (spreadsheetId === undefined) {
      throw new Error('Give the spreadsheet id (or its full URL) after the workspace id.');
    }
    // Prove we can reach and write it before committing to it, then fill in what exists today.
    await writeSnapshot(store, deps.gateway, workspaceId, spreadsheetId);
    await setSheetsIntegration(pool, workspaceId, spreadsheetId);
    deps.write(
      `Workspace ${workspaceId} is connected: https://docs.google.com/spreadsheets/d/${spreadsheetId}. Its current state is in the Resources tab; changes from now on appear in both tabs while the sync worker runs.`,
    );
    return 0;
  } catch (error) {
    deps.write(`sheets ${command} failed: ${errorMessage(error)}`);
    return 1;
  } finally {
    await pool?.end();
  }
}
