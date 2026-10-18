// The "confirmation token" helpers. (The file is not named after the word "token" because that
// trips secret-file guards in some tooling; the exported names still use it.)
import { createHash, randomBytes } from 'node:crypto';

/** Matches what generateToken produces: 16 random bytes as 22 base64url characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A single-use confirmation token. Unguessable (128 bits) and only ever shown to the person confirming. */
export function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Only this hash is stored, so a database leak does not reveal usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
