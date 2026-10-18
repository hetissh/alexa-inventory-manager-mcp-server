import type { Migration } from '../migrator.js';
import { migration0001 } from './0001_init.js';

/** In order. Never edit a migration that has been applied anywhere: add a new one. */
export const MIGRATIONS: readonly Migration[] = [migration0001];
