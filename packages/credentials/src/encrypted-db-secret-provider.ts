import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptionContext, SecretProvider } from "./secret-provider";

/**
 * Default/dev SecretProvider — envelope encryption entirely within Postgres, no external
 * KMS required. Real envelope encryption, not a placeholder: each credential gets its own
 * random 256-bit data key, which encrypts the payload; the data key itself is then
 * encrypted ("wrapped") by the deployment's root key. Both layers use AES-256-GCM with the
 * organizationId as additional authenticated data (AAD) — decryption fails closed if either
 * the ciphertext is tampered with or it's decrypted under the wrong org's context.
 *
 * Swappable for AwsSecretsManagerProvider / AzureKeyVaultProvider / GcpSecretManagerProvider
 * behind the same SecretProvider interface — see docs/credentials.md. Those cloud adapters
 * are not implemented yet (tracked for Phase 12 production hardening); selecting them via
 * SECRET_PROVIDER throws clearly rather than silently falling back.
 */
const ALGORITHM = "aes-256-gcm";
const ROOT_KEY_BYTES = 32;
const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;

interface EnvelopeBlob {
  v: number;
  wrappedDataKey: string;
  payload: string;
}

export class EncryptedDbSecretProvider implements SecretProvider {
  private readonly rootKey: Buffer;

  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== ROOT_KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_MASTER_KEY must decode (base64) to exactly ${ROOT_KEY_BYTES} bytes — got ${key.length}. Generate one with: openssl rand -base64 32`,
      );
    }
    this.rootKey = key;
  }

  async encrypt(plaintext: Record<string, unknown>, context: EncryptionContext): Promise<string> {
    const dataKey = randomBytes(DATA_KEY_BYTES);
    const aad = Buffer.from(context.organizationId, "utf8");

    const payload = this.seal(Buffer.from(JSON.stringify(plaintext), "utf8"), dataKey, aad);
    const wrappedDataKey = this.seal(dataKey, this.rootKey, aad);

    const blob: EnvelopeBlob = { v: ENVELOPE_VERSION, wrappedDataKey, payload };
    return Buffer.from(JSON.stringify(blob), "utf8").toString("base64");
  }

  async decrypt(
    ciphertext: string,
    context: EncryptionContext,
  ): Promise<Record<string, unknown>> {
    let blob: EnvelopeBlob;
    try {
      blob = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
    } catch {
      throw new Error("Malformed credential ciphertext");
    }
    if (blob.v !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported credential envelope version: ${blob.v}`);
    }

    const aad = Buffer.from(context.organizationId, "utf8");
    const dataKey = this.open(blob.wrappedDataKey, this.rootKey, aad);
    const plaintext = this.open(blob.payload, dataKey, aad);
    return JSON.parse(plaintext.toString("utf8"));
  }

  private seal(plaintext: Buffer, key: Buffer, aad: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  }

  /** Throws (via Node's cipher internals) if the AAD, key, or ciphertext don't match —
   *  i.e. the blob was tampered with or is being opened under the wrong organizationId. */
  private open(sealed: string, key: Buffer, aad: Buffer): Buffer {
    const raw = Buffer.from(sealed, "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
