/**
 * Password-reset tokens — same "store only a hash" discipline as a password, but with
 * SHA-256 (via Web Crypto, native to both Workers and Node) rather than bcrypt: the token
 * itself is 256 bits of random entropy (unlike a human-chosen password), so a fast hash
 * loses nothing on brute-force resistance while making the unique-index lookup in
 * PasswordResetTokenRepository.findValidByHash a plain equality check instead of a bcrypt
 * comparison against every row. The raw token is only ever the one emailed to the user —
 * it's never persisted, so a database read alone can't be replayed as a valid reset link.
 */

const TOKEN_BYTES = 32; // 256 bits

export function generatePasswordResetToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashResetToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** How long a reset link stays valid after being requested. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
