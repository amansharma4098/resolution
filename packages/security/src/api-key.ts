/**
 * Long-lived API keys — for a programmatic caller that can't hold the browser session
 * cookie (ARCHITECTURE.md §9's `/api/mcp` server, or any future script/CI use). Same
 * store-only-a-hash discipline as a password-reset token (see hash.ts) but no expiry: a
 * key is valid until its owner explicitly revokes it (`ApiKeyRepository.revoke`).
 *
 * `rsk_` prefix (Resolution Secret Key) makes a leaked key greppable/recognizable in logs
 * and secret scanners, the same convention as `sk-ant-...`/`re_...` from the providers this
 * codebase already integrates with.
 */
import { generateRandomToken, sha256Hex } from "./hash";

const TOKEN_BYTES = 32; // 256 bits
const PREFIX = "rsk_";

export function generateApiKey(): string {
  return `${PREFIX}${generateRandomToken(TOKEN_BYTES)}`;
}

export async function hashApiKey(token: string): Promise<string> {
  return sha256Hex(token);
}

/** A short, display-safe fragment of the key — enough for a user to recognize which key is
 *  which in a list, never enough to reconstruct or guess it. Same masking discipline as
 *  Credential's maskedHintFor (packages/credentials/src/credential-payload.ts). */
export function apiKeyDisplayHint(token: string): string {
  return `${PREFIX}••••${token.slice(-4)}`;
}
