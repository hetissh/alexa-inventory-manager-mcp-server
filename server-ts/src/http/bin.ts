#!/usr/bin/env node
import { errorMessage } from '../errorMessage.js';
import { createStderrDestination } from '../logger.js';
import { startBoardServer } from './main.js';

startBoardServer({ env: process.env, logDestination: createStderrDestination(), proc: process })
  .then((board) => board.finished)
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`voiceops-board failed: ${errorMessage(error)}\n`);
    process.exit(1);
  });
