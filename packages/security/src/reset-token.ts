/**
 * Password-reset tokens — same "store only a hash" discipline as a password. See hash.ts's
 * header comment for why a plain SHA-256 (not bcrypt) is the right trade-off here. The raw
 * token is only ever the one emailed to the user — it's never persisted, so a database read
 * alone can't be replayed as a valid reset link.
 */
import { generateRandomToken, sha256Hex } from "./hash";

const TOKEN_BYTES = 32; // 256 bits

export function generatePasswordResetToken(): string {
  return generateRandomToken(TOKEN_BYTES);
}

export async function hashResetToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** How long a reset link stays valid after being requested. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
