import type { OperationName } from '../types.js';
import { adjustQuantity } from './adjustQuantity.js';
import type { Operation } from './types.js';

const OPERATIONS: Readonly<Record<OperationName, Operation>> = {
  ADJUST_QUANTITY: adjustQuantity,
};

export function getOperation(name: OperationName): Operation {
  return OPERATIONS[name];
}
