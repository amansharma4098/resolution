import { describe, expect, it } from "vitest";
import { generatePasswordResetToken, hashResetToken } from "../reset-token";

describe("reset-token", () => {
  it("generates a long, high-entropy random token", () => {
    const a = generatePasswordResetToken();
    const b = generatePasswordResetToken();
    expect(a).toHaveLength(64); // 32 bytes, hex-encoded
    expect(a).not.toBe(b);
  });

  it("hashes deterministically, so the same raw token always looks up the same row", async () => {
    const token = generatePasswordResetToken();
    expect(await hashResetToken(token)).toBe(await hashResetToken(token));
  });

  it("hashes different tokens to different values", async () => {
    const a = await hashResetToken(generatePasswordResetToken());
    const b = await hashResetToken(generatePasswordResetToken());
    expect(a).not.toBe(b);
  });

  it("never stores the raw token itself as its own hash", async () => {
    const token = generatePasswordResetToken();
    expect(await hashResetToken(token)).not.toBe(token);
  });
});
