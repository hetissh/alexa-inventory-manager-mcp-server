#!/usr/bin/env node
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`voiceops-mcp failed to start: ${message}\n`);
  process.exit(1);
});
