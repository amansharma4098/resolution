import { describe, expect, it } from "vitest";
import { apiKeyDisplayHint, generateApiKey, hashApiKey } from "../api-key";

describe("api-key", () => {
  it("generates a prefixed, high-entropy key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("rsk_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically", async () => {
    const key = generateApiKey();
    expect(await hashApiKey(key)).toBe(await hashApiKey(key));
  });

  it("never stores the raw key as its own hash", async () => {
    const key = generateApiKey();
    expect(await hashApiKey(key)).not.toBe(key);
  });

  it("displays only a short, non-reconstructable hint", () => {
    const key = generateApiKey();
    const hint = apiKeyDisplayHint(key);
    expect(hint).toBe(`rsk_••••${key.slice(-4)}`);
    expect(hint.length).toBeLessThan(key.length);
  });
});
