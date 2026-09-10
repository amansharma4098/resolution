/**
 * Jira Cloud's native issue-webhook feature doesn't sign its requests the way, say,
 * GitHub or Stripe do — there's no HMAC header to verify. Atlassian's own guidance for
 * securing a webhook receiver is a shared secret baked into the target URL or sent as a
 * custom header (achievable via Jira's "Automation for Jira" outgoing-webhook actions,
 * which do let you set arbitrary headers). This platform uses a per-integration random
 * secret, generated when the Integration is created and never shown again after that
 * (same masking discipline as credentials) — the customer configures their Jira webhook
 * to send it as the `X-Webhook-Secret` header. ServiceNow's Business Rule-triggered
 * outbound REST calls support the same pattern (Phase 4).
 */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison — a naive `===` on secrets is a timing side-channel. */
export function verifyWebhookSecret(provided: string | null | undefined, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
