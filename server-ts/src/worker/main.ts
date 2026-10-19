import type { DestinationStream } from 'pino';

import type { SheetsGateway } from '../app/syncPorts.js';
import { createSyncWorker } from '../app/syncWorker.js';
import { createWorkerServices } from '../composition.js';
import { loadConfig } from '../config.js';
import { SHUTDOWN_SIGNALS, type SignalSource } from '../lifecycle.js';
import { createLogger } from '../logger.js';

export interface WorkerDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly logDestination: DestinationStream;
  readonly proc: SignalSource;
  /** Where spreadsheet updates are written. */
  readonly gateway: SheetsGateway;
}

export interface RunningWorker {
  /** Asks the worker to finish what it is doing and stop. Safe to call more than once. */
  stop(reason: string): void;
  /** Resolves once the worker has stopped and released the database. */
  readonly finished: Promise<void>;
}

/**
 * Starts the background process that copies committed changes to Google Sheets. It is a separate process from
 * the MCP server (which a client starts and stops at will), and several can run at once safely.
 */
export async function startWorker(deps: WorkerDeps): Promise<RunningWorker> {
  const config = loadConfig(deps.env);
  const logger = createLogger(config.logLevel, deps.logDestination);
  const services = await createWorkerServices(config, logger);
  const worker = createSyncWorker({
    store: services.store,
    queue: services.queue,
    gateway: deps.gateway,
    logger,
    options: { pollMs: config.syncPollMs },
  });

  const controller = new AbortController();
  const stop = (reason: string): void => {
    if (!controller.signal.aborted) {
      logger.info({ reason }, 'stopping the sync worker');
      controller.abort();
    }
  };
  const listeners = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => {
      stop(signal);
    };
    deps.proc.on(signal, listener);
    return { signal, listener };
  });

  logger.info({ pollMs: config.syncPollMs }, 'voiceops spreadsheet sync worker ready');
  const finished = worker.run(controller.signal).finally(async () => {
    for (const { signal, listener } of listeners) {
      deps.proc.off(signal, listener);
    }
    await services.close();
  });
  return { stop, finished };
}
