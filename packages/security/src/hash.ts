/**
 * Shared random-token / SHA-256 primitives (Web Crypto — native to both Workers and Node,
 * no dependency) behind any "store only a hash of a long random secret" flow: password
 * reset tokens (reset-token.ts) and API keys (api-key.ts) both use exactly this shape. A
 * fast hash is the right choice for both — the secret itself is already high-entropy random
 * bytes, not a human-chosen password, so bcrypt's deliberate slowness buys nothing and would
 * cost a real, avoidable delay on every authenticated API request.
 */

export function generateRandomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
