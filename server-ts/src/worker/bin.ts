#!/usr/bin/env node
import { errorMessage } from '../errorMessage.js';
import { createGoogleSheetsApi } from '../infra/sheets/googleClient.js';
import { createGoogleSheetsGateway } from '../infra/sheets/googleGateway.js';
import { createStderrDestination } from '../logger.js';
import { startWorker } from './main.js';

startWorker({
  env: process.env,
  logDestination: createStderrDestination(),
  proc: process,
  gateway: createGoogleSheetsGateway(createGoogleSheetsApi()),
})
  .then((worker) => worker.finished)
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`voiceops-worker failed: ${errorMessage(error)}\n`);
    process.exit(1);
  });
