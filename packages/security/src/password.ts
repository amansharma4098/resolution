import bcrypt from "bcryptjs";

// Cost factor 12 — OWASP's current floor for bcrypt. Hashing runs on the API process, not
// per-request-critical-path beyond login/signup, so the extra cost over the bcrypt default
// (10) is worth it.
const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Minimum viable password policy enforced server-side (never trust client-side validation
 * alone). Kept deliberately simple for Phase 1 — length is the strongest practical signal;
 * composition rules are known to push users toward predictable substitutions without
 * meaningfully raising entropy.
 */
export function isPasswordStrongEnough(plaintext: string): boolean {
  return plaintext.length >= 12;
}

/** A random, strong temporary password for an admin- or Super-Admin-created local user —
 *  shown to the creator exactly once in the response (same masking discipline as
 *  credentials); the new user is expected to change it on first login. No email delivery is
 *  wired up yet, so relaying it is on the creator for now. Shared by
 *  apps/api/src/routes/organizations.ts (org admin invites a teammate) and
 *  apps/api/src/routes/platform.ts (Super Admin provisions a new tenant's admin). */
export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
