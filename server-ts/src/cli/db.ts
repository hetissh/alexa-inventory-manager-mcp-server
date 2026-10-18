import { type Config, loadConfig } from '../config.js';
import { errorMessage } from '../errorMessage.js';
import { ensureDatabase } from '../infra/db/admin.js';
import { assertSchemaUpToDate, migrate } from '../infra/db/migrator.js';
import { createPool, describeDatabase, isLocalDatabase, poolErrorReporter } from '../infra/db/pool.js';
import { seedWorkspace } from '../infra/db/seed.js';
import { listTemplates } from '../templates/index.js';

const COMMANDS = ['create', 'migrate', 'seed', 'reset', 'setup'] as const;
type DbCommand = (typeof COMMANDS)[number];

export const DB_USAGE = [
  'Usage: db <command>',
  '  create   create the database named in DATABASE_URL if it does not exist',
  '  migrate  apply pending schema migrations',
  '  seed     add the demo workspace and any missing demo resources (never overwrites live data)',
  '  reset    DELETE the demo workspace data (events, resources) and restore the fixture',
  '  setup    create + migrate + seed (safe to repeat)',
].join('\n');

export interface DbCliDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly write: (line: string) => void;
}

function isCommand(value: string | undefined): value is DbCommand {
  return COMMANDS.some((command) => command === value);
}

function assertResetAllowed(databaseUrl: string, env: NodeJS.ProcessEnv): void {
  if (!isLocalDatabase(databaseUrl) && env['VOICEOPS_ALLOW_REMOTE_RESET'] !== '1') {
    throw new Error(
      `Refusing to reset ${describeDatabase(databaseUrl)}: it is not a local database. Set VOICEOPS_ALLOW_REMOTE_RESET=1 if you really mean it.`,
    );
  }
}

async function execute(command: DbCommand, config: Config, deps: DbCliDeps): Promise<void> {
  const url = config.databaseUrl;
  if (command === 'reset') {
    assertResetAllowed(url, deps.env);
  }
  if (command === 'create' || command === 'setup') {
    deps.write(`Database ${describeDatabase(url)}: ${await ensureDatabase(url)}.`);
  }
  if (command === 'create') {
    return;
  }

  const pool = createPool(url, poolErrorReporter(deps.write));
  try {
    if (command === 'migrate' || command === 'setup') {
      const applied = await migrate(pool);
      deps.write(applied.length === 0 ? 'Schema is up to date.' : `Applied migrations: ${applied.join(', ')}.`);
    }
    if (command !== 'migrate') {
      await assertSchemaUpToDate(pool);
      for (const template of listTemplates()) {
        const result = await seedWorkspace(pool, template, { reset: command === 'reset' });
        deps.write(
          `Workspace ${result.workspaceId}: ${result.reset ? 'reset to the fixture' : `${String(result.resourcesCreated)} resource(s) added`}.`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}

/** Runs a database maintenance command and returns the process exit code. Never throws. */
export async function runDbCli(args: readonly string[], deps: DbCliDeps): Promise<number> {
  const [command] = args;
  if (!isCommand(command)) {
    deps.write(DB_USAGE);
    return 2;
  }
  try {
    await execute(command, loadConfig(deps.env), deps);
    return 0;
  } catch (error) {
    deps.write(`db ${command} failed: ${errorMessage(error)}`);
    return 1;
  }
}
