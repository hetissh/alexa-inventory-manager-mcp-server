#!/usr/bin/env node
import { errorMessage } from './errorMessage.js';
import { createStderrDestination } from './logger.js';
import { main } from './main.js';
import { installStdoutGuard } from './stdout-guard.js';

installStdoutGuard(console);

main({
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  logDestination: createStderrDestination(),
  proc: process,
}).catch((error: unknown) => {
  process.stderr.write(`voiceops-mcp failed to start: ${errorMessage(error)}\n`);
  process.exit(1);
});
