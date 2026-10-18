import { runDbCli } from './db.js';

// runDbCli reports its own failures through the exit code and never rejects.
void runDbCli(process.argv.slice(2), {
  env: process.env,
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
}).then((code) => {
  process.exitCode = code;
});
