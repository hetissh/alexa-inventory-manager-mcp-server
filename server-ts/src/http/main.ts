import type { AddressInfo } from 'node:net';

import type { DestinationStream } from 'pino';

import { createServices } from '../composition.js';
import { loadConfig } from '../config.js';
import { SHUTDOWN_SIGNALS, type SignalSource } from '../lifecycle.js';
import { createLogger } from '../logger.js';
import { createBoardServer, hostAllowList } from './boardServer.js';

export interface BoardDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly logDestination: DestinationStream;
  readonly proc: SignalSource;
}

export interface RunningBoard {
  /** The port actually listening (useful when the configured port is 0). */
  readonly port: number;
  stop(reason: string): void;
  /** Resolves once the server has stopped and released the database. */
  readonly finished: Promise<void>;
}

/**
 * Starts the live-board web server: a read-only view of each workspace for a screen (a browser or the Fire TV).
 * It is its own process, like the sync worker, because the MCP server's lifetime belongs to the Claude client.
 */
export async function startBoardServer(deps: BoardDeps): Promise<RunningBoard> {
  const config = loadConfig(deps.env);
  const logger = createLogger(config.logLevel, deps.logDestination);
  const services = await createServices(config, logger);
  const { host, port, token, pollMs } = config.board;
  const server = createBoardServer({
    reads: services.reads,
    logger,
    workspaceIds: config.workspaceIds,
    defaultWorkspaceId: config.workspaceId,
    pollMs,
    token,
    allowedHostnames: hostAllowList(host),
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await services.close();
    throw error;
  }
  const listening = (server.address() as AddressInfo).port;

  let closing = false;
  const closed = new Promise<void>((resolve) => {
    server.once('close', resolve);
  });
  const stop = (reason: string): void => {
    if (!closing) {
      closing = true;
      logger.info({ reason }, 'stopping the board server');
      server.close();
      server.closeAllConnections();
    }
  };
  const listeners = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => {
      stop(signal);
    };
    deps.proc.on(signal, listener);
    return { signal, listener };
  });

  logger.info({ host, port: listening, authRequired: token !== undefined }, 'voiceops board server ready');
  const finished = closed.finally(async () => {
    for (const { signal, listener } of listeners) {
      deps.proc.off(signal, listener);
    }
    await services.close();
  });
  return { port: listening, stop, finished };
}
