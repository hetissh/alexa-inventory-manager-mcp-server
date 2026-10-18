import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pino } from 'pino';

import { createMcpServer, type McpServerDeps } from '../../src/mcp/server.js';
import type { ToolContext } from '../../src/mcp/tools/context.js';
import { registerTools } from '../../src/mcp/tools/index.js';

export const silentLogger = pino({ level: 'silent' });

export const TEST_CLIENT_INFO = { name: 'test-client', version: '9.9.9' } as const;

export interface ConnectedPair {
  readonly client: Client;
  readonly server: McpServer;
  close(): Promise<void>;
}

async function link(server: McpServer): Promise<ConnectedPair> {
  const client = new Client(TEST_CLIENT_INFO);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Connects a real client to the real server (via createMcpServer) over an in-memory transport. */
export async function connectInMemory(overrides: Partial<McpServerDeps> = {}): Promise<ConnectedPair> {
  const server = createMcpServer({
    logger: silentLogger,
    uptimeSeconds: () => 42.9,
    nodeVersion: 'v24.0.0-test',
    ...overrides,
  });
  return link(server);
}

/** Registers the tools on a bare McpServer with a custom ToolContext (to simulate odd contexts). */
export async function connectWithContext(context: ToolContext): Promise<ConnectedPair> {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  registerTools(server, context);
  return link(server);
}
