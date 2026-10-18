import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  CONFIRMATION_GUIDANCE,
  idempotencyKeyParam,
  RECORD_CHANGE_ANNOTATIONS,
  type ToolContext,
  workspaceFor,
  workspaceIdParam,
} from './context.js';
import { requestChange, writeOutputSchema } from './writeResult.js';

const inputSchema = {
  job: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The job as the user named it, for example "job 108" or "job one oh eight".'),
  assignee: z.string().trim().min(1).max(100).describe('The technician as the user named them, for example "Rahul".'),
  idempotencyKey: idempotencyKeyParam,
  workspaceId: workspaceIdParam,
};

export function registerAssignJob(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'assign-job',
    {
      title: 'Assign a job to a technician',
      description: [
        'Assigns a job to an active technician, for example "assign job one oh eight to Rahul". A job that is already assigned can be reassigned.',
        'Pass the job and technician as the user said them; the server matches them. If the status is "ambiguous" or "not_found" ("role" says whether it was the job or the assignee), ask the user which one they meant and wait: do not retry with a guess.',
        'A "rejected" result means nothing changed: tell the user why (for example the technician is not on duty, or the job is already done).',
        CONFIRMATION_GUIDANCE,
        'Report only what the result says (quote "spoken"). Never claim a spreadsheet or board was updated unless "sync" says so.',
      ].join(' '),
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: RECORD_CHANGE_ANNOTATIONS,
    },
    async ({ job, assignee, idempotencyKey, workspaceId }) =>
      requestChange(context, workspaceFor(context, workspaceId), {
        operation: 'ASSIGN_JOB',
        target: job,
        arguments: { assignee },
        idempotencyKey,
      }),
  );
}
