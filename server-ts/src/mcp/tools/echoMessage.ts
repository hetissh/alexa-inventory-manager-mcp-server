import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { READ_ONLY_ANNOTATIONS, type ToolContext } from './context.js';

const MAX_MESSAGE_LENGTH = 200;

const inputSchema = {
  message: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe(`Text to echo back, 1-${String(MAX_MESSAGE_LENGTH)} characters. Surrounding whitespace is removed.`),
};

const outputSchema = {
  message: z.string().describe('The validated message, echoed back.'),
  length: z.number().int().nonnegative().describe('Length of the echoed message in characters.'),
};

export function registerEchoMessage(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'echo-message',
    {
      title: 'Echo a message',
      description:
        'Diagnostic: validates the message argument and returns it unchanged. Use it to confirm that arguments reach the server intact. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ message }) => {
      // Log the length only: message content is user data and may be sensitive.
      context.logger.debug({ tool: 'echo-message', length: message.length }, 'tool called');
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { message, length: message.length },
      };
    },
  );
}
