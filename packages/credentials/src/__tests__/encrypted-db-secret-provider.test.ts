import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EncryptedDbSecretProvider } from "../encrypted-db-secret-provider";

function freshMasterKey(): string {
  return randomBytes(32).toString("base64");
}

describe("EncryptedDbSecretProvider", () => {
  it("round-trips a payload for the same organization", async () => {
    const provider = new EncryptedDbSecretProvider(freshMasterKey());
    const payload = { apiKey: "sk-live-abcdef123456" };

    const ciphertext = await provider.encrypt(payload, { organizationId: "org-1" });
    expect(ciphertext).not.toContain("sk-live-abcdef123456");

    const decrypted = await provider.decrypt(ciphertext, { organizationId: "org-1" });
    expect(decrypted).toEqual(payload);
  });

  it("produces different ciphertext for the same payload every time (random IV/data key)", async () => {
    const provider = new EncryptedDbSecretProvider(freshMasterKey());
    const payload = { apiKey: "sk-live-abcdef123456" };

    const a = await provider.encrypt(payload, { organizationId: "org-1" });
    const b = await provider.encrypt(payload, { organizationId: "org-1" });
    expect(a).not.toBe(b);
  });

  it("refuses to decrypt under a different organizationId (AAD binding)", async () => {
    const provider = new EncryptedDbSecretProvider(freshMasterKey());
    const ciphertext = await provider.encrypt({ apiKey: "x" }, { organizationId: "org-1" });

    await expect(provider.decrypt(ciphertext, { organizationId: "org-2" })).rejects.toThrow();
  });

  it("refuses to decrypt with a different root key", async () => {
    const providerA = new EncryptedDbSecretProvider(freshMasterKey());
    const providerB = new EncryptedDbSecretProvider(freshMasterKey());
    const ciphertext = await providerA.encrypt({ apiKey: "x" }, { organizationId: "org-1" });

    await expect(providerB.decrypt(ciphertext, { organizationId: "org-1" })).rejects.toThrow();
  });

  it("refuses to decrypt tampered ciphertext", async () => {
    const provider = new EncryptedDbSecretProvider(freshMasterKey());
    const ciphertext = await provider.encrypt({ apiKey: "x" }, { organizationId: "org-1" });

    const blob = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
    // Flip a byte in the payload's base64 to corrupt the ciphertext.
    blob.payload = blob.payload.slice(0, -4) + (blob.payload.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    const tampered = Buffer.from(JSON.stringify(blob), "utf8").toString("base64");

    await expect(provider.decrypt(tampered, { organizationId: "org-1" })).rejects.toThrow();
  });

  it("rejects a master key that isn't exactly 32 bytes decoded", () => {
    expect(() => new EncryptedDbSecretProvider(Buffer.from("too-short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });

  it("round-trips a multi-field SERVICE_PRINCIPAL-shaped payload", async () => {
    const provider = new EncryptedDbSecretProvider(freshMasterKey());
    const payload = { tenantId: "t1", clientId: "c1", clientSecret: "s1" };
    const ciphertext = await provider.encrypt(payload, { organizationId: "org-42" });
    const decrypted = await provider.decrypt(ciphertext, { organizationId: "org-42" });
    expect(decrypted).toEqual(payload);
  });
});
