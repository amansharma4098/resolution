import { describe, expect, it } from "vitest";
import { maskedHintFor, validateCredentialPayload } from "../credential-payload";

describe("validateCredentialPayload", () => {
  it("accepts a well-formed API_KEY payload", () => {
    expect(validateCredentialPayload("API_KEY", { apiKey: "sk-123" })).toEqual({
      apiKey: "sk-123",
    });
  });

  it("rejects a missing required field", () => {
    expect(() => validateCredentialPayload("API_KEY", {})).toThrow();
  });

  it("rejects an empty CUSTOM payload", () => {
    expect(() => validateCredentialPayload("CUSTOM", {})).toThrow(/at least one field/);
  });

  it("accepts a non-empty CUSTOM payload", () => {
    expect(validateCredentialPayload("CUSTOM", { region: "us-east-1" })).toEqual({
      region: "us-east-1",
    });
  });

  it("rejects extra fields it doesn't recognize as strings for CUSTOM (non-string value)", () => {
    expect(() => validateCredentialPayload("CUSTOM", { count: 5 })).toThrow();
  });
});

describe("maskedHintFor", () => {
  it("shows only the last 4 characters of the primary secret field", () => {
    expect(maskedHintFor("API_KEY", { apiKey: "sk-live-abcdef1234" })).toBe("••••1234");
  });

  it("falls back to a generic mask when the value is too short", () => {
    expect(maskedHintFor("API_KEY", { apiKey: "ab" })).toBe("••••••••");
  });

  it("never contains any character from the underlying secret beyond the last 4", () => {
    const secret = "sk-live-supersecretvalue9999";
    const hint = maskedHintFor("API_KEY", { apiKey: secret });
    expect(hint).toBe("••••9999");
    expect(hint).not.toContain("supersecret");
  });

  it("masks CUSTOM payloads generically (no single primary field)", () => {
    expect(maskedHintFor("CUSTOM", { region: "us-east-1" })).toBe("••••••••");
  });
});
