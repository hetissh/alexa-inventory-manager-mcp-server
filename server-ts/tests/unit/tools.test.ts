import { afterEach, describe, expect, it } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../../src/mcp/server.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import {
  type ConnectedPair,
  connectInMemory,
  connectWithContext,
  silentLogger,
  TEST_CLIENT_INFO,
} from '../helpers/connect.js';

let pair: ConnectedPair | undefined;

afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('server metadata', () => {
  it('reports its name, version and instructions on initialize', async () => {
    pair = await connectInMemory();
    expect(pair.client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
    expect(pair.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });
});

describe('tool catalogue conventions (AGENTS.md)', () => {
  it('names every tool in verb-first kebab-case and declares all hints', async () => {
    pair = await connectInMemory();
    const { tools } = await pair.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['check-health', 'echo-message']);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      expect(tool.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean) as boolean,
          idempotentHint: expect.any(Boolean) as boolean,
          destructiveHint: expect.any(Boolean) as boolean,
        }),
      );
      expect(tool.description).toBeTruthy();
    }
  });
});

describe('check-health', () => {
  it('returns structured health data including the connected client', async () => {
    pair = await connectInMemory();
    const result = await pair.client.callTool({ name: 'check-health', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      nodeVersion: 'v24.0.0-test',
      uptimeSeconds: 42,
      client: TEST_CLIENT_INFO,
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: `VoiceOps server ok: ${SERVER_NAME} ${SERVER_VERSION}, uptime 42s, client test-client 9.9.9.`,
      },
    ]);
  });

  it('reports a null client when the client is unknown', async () => {
    pair = await connectWithContext({
      logger: silentLogger,
      uptimeSeconds: () => 1,
      nodeVersion: 'v24.0.0-test',
      getClientInfo: () => undefined,
    });
    const result = await pair.client.callTool({ name: 'check-health', arguments: {} });
    expect(result.structuredContent).toMatchObject({ client: null });
    expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining('unknown client') as string })]);
  });
});

describe('echo-message', () => {
  it('echoes the trimmed message with its length', async () => {
    pair = await connectInMemory();
    const result = await pair.client.callTool({ name: 'echo-message', arguments: { message: '  hello voiceops  ' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ message: 'hello voiceops', length: 14 });
    expect(result.content).toEqual([{ type: 'text', text: 'hello voiceops' }]);
  });

  it.each([
    ['an empty message', { message: '' }],
    ['a whitespace-only message', { message: '   ' }],
    ['an over-long message', { message: 'x'.repeat(201) }],
    ['a non-string message', { message: 42 }],
    ['a missing message', {}],
  ])('rejects %s', async (_label, args) => {
    pair = await connectInMemory();
    const outcome = await pair.client
      .callTool({ name: 'echo-message', arguments: args })
      .then((result) => ({ rejected: false, isError: result.isError === true }))
      .catch(() => ({ rejected: true, isError: false }));
    expect(outcome.rejected || outcome.isError).toBe(true);
  });
});
