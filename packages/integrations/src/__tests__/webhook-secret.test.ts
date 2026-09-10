import { describe, expect, it } from "vitest";
import { generateWebhookSecret, verifyWebhookSecret } from "../webhook-secret";

describe("webhook secret", () => {
  it("generates a 64-character hex secret", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different secret every time", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });

  it("verifies a matching secret", () => {
    const secret = generateWebhookSecret();
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
  });

  it("rejects a non-matching secret", () => {
    expect(verifyWebhookSecret("wrong", generateWebhookSecret())).toBe(false);
  });

  it("rejects a missing secret", () => {
    expect(verifyWebhookSecret(null, generateWebhookSecret())).toBe(false);
    expect(verifyWebhookSecret(undefined, generateWebhookSecret())).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    expect(verifyWebhookSecret("short", generateWebhookSecret())).toBe(false);
  });
});
