import { createGoogleSheetsApi } from '../infra/sheets/googleClient.js';
import { createGoogleSheetsGateway } from '../infra/sheets/googleGateway.js';
import { runSheetsCli } from './sheets.js';

// runSheetsCli reports its own failures through the exit code and never rejects.
void runSheetsCli(process.argv.slice(2), {
  env: process.env,
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
  gateway: createGoogleSheetsGateway(createGoogleSheetsApi()),
}).then((code) => {
  process.exitCode = code;
});
