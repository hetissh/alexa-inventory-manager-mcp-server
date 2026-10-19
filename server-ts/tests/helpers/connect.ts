import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pino } from 'pino';

import { createServices, type Services } from '../../src/composition.js';
import { createMcpServer } from '../../src/mcp/server.js';
import type { ToolContext } from '../../src/mcp/tools/context.js';
import { registerTools } from '../../src/mcp/tools/index.js';
import { ALL_WORKSPACE_IDS, createTestPool, resetAll, TEST_DATABASE_URL, WORKSPACE_ID } from './db.js';

export const silentLogger = pino({ level: 'silent' });

export const TEST_CLIENT_INFO = { name: 'test-client', version: '9.9.9' } as const;
export const TEST_ACTOR = 'test-actor';

export interface ConnectedPair {
  readonly client: Client;
  readonly server: McpServer;
  readonly services: Services;
  close(): Promise<void>;
}

/** Restores every demo workspace and opens real services against the test database. */
async function openServices(): Promise<Services> {
  const pool = createTestPool();
  try {
    await resetAll(pool);
  } finally {
    await pool.end();
  }
  return createServices(
    {
      logLevel: 'silent',
      databaseUrl: TEST_DATABASE_URL,
      workspaceId: WORKSPACE_ID,
      workspaceIds: ALL_WORKSPACE_IDS,
      actorId: TEST_ACTOR,
      syncPollMs: 1000,
      demoTools: false,
    },
    silentLogger,
  );
}

async function link(server: McpServer, services: Services): Promise<ConnectedPair> {
  const client = new Client(TEST_CLIENT_INFO);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    services,
    close: async () => {
      await client.close();
      await server.close();
      await services.close();
    },
  };
}

/** A real client talking to the real server (createMcpServer) backed by the real test database. */
export async function connectInMemory(): Promise<ConnectedPair> {
  const services = await openServices();
  const server = createMcpServer({
    logger: silentLogger,
    uptimeSeconds: () => 42.9,
    nodeVersion: 'v24.0.0-test',
    defaultWorkspaceId: WORKSPACE_ID,
    workspaceIds: ALL_WORKSPACE_IDS,
    actorId: TEST_ACTOR,
    commands: services.commands,
    reads: services.reads,
    sync: services.sync,
    demo: services.demo,
  });
  return link(server, services);
}

/** Registers the tools on a bare server so a test can override parts of the ToolContext. */
export async function connectWithContext(
  overrides: Partial<ToolContext> | ((services: Services) => Partial<ToolContext>) = {},
): Promise<ConnectedPair> {
  const services = await openServices();
  const extra = typeof overrides === 'function' ? overrides(services) : overrides;
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  registerTools(server, {
    logger: silentLogger,
    uptimeSeconds: () => 1,
    nodeVersion: 'v24.0.0-test',
    getClientInfo: () => TEST_CLIENT_INFO,
    defaultWorkspaceId: WORKSPACE_ID,
    workspaceIds: ALL_WORKSPACE_IDS,
    actorId: TEST_ACTOR,
    commands: services.commands,
    reads: services.reads,
    sync: services.sync,
    demo: services.demo,
    ...extra,
  });
  return link(server, services);
}
