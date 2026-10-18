import type { Readable, Writable } from 'node:stream';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { DestinationStream } from 'pino';

import { createServices } from './composition.js';
import { loadConfig } from './config.js';
import { registerShutdownTriggers, type SignalSource } from './lifecycle.js';
import { createLogger } from './logger.js';
import { createMcpServer } from './mcp/server.js';
import { SERVER_VERSION } from './version.js';

/** The subset of `process` the server needs; injected so tests never touch the real process. */
export interface ProcessLike extends SignalSource {
  exit(code: number): void;
  uptime(): number;
  readonly version: string;
}

export interface MainDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly logDestination: DestinationStream;
  readonly proc: ProcessLike;
}

export interface RunningServer {
  readonly server: McpServer;
  /** Closes the transport and database pool, then exits the process with code 0. Idempotent. */
  shutdown(reason: string): Promise<void>;
}

/** Composition root: wires config, logging, the database, the MCP server and stdio, and owns shutdown. */
export async function main(deps: MainDeps): Promise<RunningServer> {
  const config = loadConfig(deps.env);
  const logger = createLogger(config.logLevel, deps.logDestination);
  const services = await createServices(config, logger);
  const server = createMcpServer({
    logger,
    uptimeSeconds: () => deps.proc.uptime(),
    nodeVersion: deps.proc.version,
    workspaceId: config.workspaceId,
    actorId: config.actorId,
    commands: services.commands,
    reads: services.reads,
  });

  const performShutdown = async (reason: string): Promise<void> => {
    logger.info({ reason }, 'shutting down');
    removeTriggers(); // declared below; only ever runs after it has been initialised
    // Close both even if one fails, then exit regardless: the process is going away either way.
    const results = await Promise.allSettled([server.close(), services.close()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'error during shutdown');
      }
    }
    deps.proc.exit(0);
  };
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (reason: string): Promise<void> => {
    // Deferred so the promise is stored before the body runs: closing the server fires
    // `onclose` synchronously, which re-enters here and must see the in-flight shutdown.
    shutdownPromise ??= Promise.resolve().then(() => performShutdown(reason));
    return shutdownPromise;
  };
  const requestShutdown = (reason: string): void => {
    void shutdown(reason); // fire-and-forget: the shutdown routine handles its own errors
  };

  const removeTriggers = registerShutdownTriggers({ signals: deps.proc, stdin: deps.stdin }, requestShutdown);
  server.server.onclose = () => {
    requestShutdown('transport closed');
  };

  await server.connect(new StdioServerTransport(deps.stdin, deps.stdout));
  logger.info({ transport: 'stdio', version: SERVER_VERSION, workspace: config.workspaceId }, 'voiceops MCP server ready');

  return { server, shutdown };
}
