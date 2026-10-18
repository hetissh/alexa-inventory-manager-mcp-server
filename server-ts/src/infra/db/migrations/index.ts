import type { Migration } from '../migrator.js';
import { migration0001 } from './0001_init.js';
import { migration0002 } from './0002_confirmations_alerts.js';

/** In order. Never edit a migration that has been applied anywhere: add a new one. */
export const MIGRATIONS: readonly Migration[] = [migration0001, migration0002];
