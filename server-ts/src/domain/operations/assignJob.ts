import { z } from 'zod';

import { defineOperation } from './types.js';

const argsSchema = z.object({
  assignee: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The technician as the user named them, for example "Rahul".'),
});

/** ASSIGN_JOB: give a job to an active technician. Always needs confirmation. */
export const assignJob = defineOperation({
  name: 'ASSIGN_JOB',
  targetTypes: ['job'],
  secondary: { role: 'assignee', types: ['technician'], query: (args) => args.assignee },
  argsSchema,
  plan(_args, job, { secondary: technician, names }) {
    if (job.type !== 'job') {
      return { kind: 'rejected', code: 'INVALID_TARGET', message: `${job.name} is not a job.` };
    }
    if (technician?.type !== 'technician') {
      return { kind: 'rejected', code: 'INVALID_ASSIGNEE', message: 'No technician was given for this job.' };
    }
    if (!technician.attributes.active) {
      return { kind: 'rejected', code: 'INVALID_ASSIGNEE', message: `${technician.name} is not an active technician.` };
    }
    const { status, assigneeId } = job.attributes;
    if (status === 'done') {
      return { kind: 'rejected', code: 'JOB_CLOSED', message: `${job.name} is already done and cannot be assigned.` };
    }
    if (assigneeId === technician.id) {
      return { kind: 'rejected', code: 'NO_CHANGE', message: `${job.name} is already assigned to ${technician.name}.` };
    }

    const nextStatus = status === 'waiting' ? 'assigned' : status;
    const previous = assigneeId === null ? undefined : (names.get(assigneeId) ?? assigneeId);
    return {
      kind: 'ready',
      attributes: { ...job.attributes, assigneeId: technician.id, status: nextStatus },
      before: { assigneeId, status },
      after: { assigneeId: technician.id, status: nextStatus },
      summary:
        previous === undefined
          ? `Assigned ${job.name} to ${technician.name}`
          : `Reassigned ${job.name} from ${previous} to ${technician.name}`,
      spoken: `${job.name} is now assigned to ${technician.name}.`,
      confirmation: {
        reason: 'assignment',
        readback:
          previous === undefined
            ? `Assign ${job.name} to ${technician.name}?`
            : `Reassign ${job.name} from ${previous} to ${technician.name}?`,
      },
    };
  },
});
