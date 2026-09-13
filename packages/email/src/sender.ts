export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Real sender — Resend's plain HTTP API via `fetch`, no SDK dependency. Same reasoning as
 * packages/security choosing `jose` over `jsonwebtoken`: this runs inside a Cloudflare
 * Worker (ARCHITECTURE.md §2), so anything on the send path has to work with Workers'
 * fetch-only, no-Node-sockets runtime.
 */
export function createResendSender(opts: { apiKey: string; from: string }): EmailSender {
  return {
    async send(message) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Resend API error ${res.status}: ${body}`);
      }
    },
  };
}

/**
 * Dev/MOCK_MODE-style fallback — logs the message instead of sending it. Same honesty
 * discipline as packages/ai's MOCK_MODE client (never disguised as a real send) and lets
 * the full signup → forgot-password → reset flow work end to end with zero external
 * accounts, the same way the rest of this project runs with zero production credentials.
 */
export function createConsoleSender(): EmailSender {
  return {
    async send(message) {
      // eslint-disable-next-line no-console
      console.log(`[MOCK EMAIL] to=${message.to} subject="${message.subject}"\n${message.text}`);
    },
  };
}

/**
 * Picks the real Resend sender when both a key and a from-address are configured, else the
 * console fallback — mirrors packages/ai/src/factory.ts's createLlmClient, which falls back
 * to its MOCK_MODE client the same way when no ANTHROPIC_API_KEY is set.
 */
export function createEmailSender(opts: { apiKey?: string; from?: string }): EmailSender {
  if (opts.apiKey && opts.from) {
    return createResendSender({ apiKey: opts.apiKey, from: opts.from });
  }
  return createConsoleSender();
}
