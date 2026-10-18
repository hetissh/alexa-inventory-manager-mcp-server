import type { OperationName } from '../types.js';
import { adjustQuantity } from './adjustQuantity.js';
import { assignJob } from './assignJob.js';
import { reverseEvent } from './reverseEvent.js';
import { setStatus } from './setStatus.js';
import type { Operation } from './types.js';

const OPERATIONS: Readonly<Record<OperationName, Operation>> = {
  ADJUST_QUANTITY: adjustQuantity,
  SET_STATUS: setStatus,
  ASSIGN_JOB: assignJob,
  REVERSE_EVENT: reverseEvent,
};

export function getOperation(name: OperationName): Operation {
  return OPERATIONS[name];
}
