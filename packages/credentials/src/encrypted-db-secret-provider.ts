import type { EncryptionContext, SecretProvider } from "./secret-provider";

/**
 * Default/dev SecretProvider — envelope encryption entirely within the database, no
 * external KMS required. Real envelope encryption, not a placeholder: each credential gets
 * its own random 256-bit data key, which encrypts the payload; the data key itself is then
 * encrypted ("wrapped") by the deployment's root key. Both layers use AES-256-GCM with the
 * organizationId as additional authenticated data (AAD) — decryption fails closed if either
 * the ciphertext is tampered with or it's decrypted under the wrong org's context.
 *
 * Built on the Web Crypto API (`crypto.subtle`) rather than Node's `node:crypto` — this is
 * the API Cloudflare Workers support natively with no compatibility flag (ARCHITECTURE.md
 * §2), and it's also available as a global in Node 18+, so the exact same code path runs
 * in apps/api's Worker deployment and in local dev/tests without any environment branching.
 *
 * Swappable for AwsSecretsManagerProvider / AzureKeyVaultProvider / GcpSecretManagerProvider
 * behind the same SecretProvider interface — see docs/credentials.md. Those cloud adapters
 * are not implemented yet (tracked for Phase 12 production hardening); selecting them via
 * SECRET_PROVIDER throws clearly rather than silently falling back.
 */
const ROOT_KEY_BYTES = 32;
const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;

interface EnvelopeBlob {
  v: number;
  wrappedDataKey: string;
  payload: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// No explicit CryptoKey return-type annotation — Cloudflare's ambient CryptoKey type
// (from @cloudflare/workers-types, needed elsewhere for the D1 binding) and Node's own
// crypto.webcrypto.CryptoKey type (from @types/node) are structurally incompatible with
// each other, so this is inferred to whichever is in scope for the ambient `crypto`
// global at compile time rather than pinned to one.
async function importAesGcmKey(rawKey: Uint8Array) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** AES-256-GCM seal: IV || ciphertext-with-appended-tag (Web Crypto appends the 16-byte
 *  auth tag to the ciphertext output itself, unlike Node's crypto which returns it
 *  separately via getAuthTag()). `aad` binds the blob to context (here, organizationId). */
async function seal(plaintext: Uint8Array, rawKey: Uint8Array, aad: Uint8Array): Promise<string> {
  const key = await importAesGcmKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext),
  );
  return toBase64(concatBytes(iv, ciphertext));
}

/** Throws if the AAD, key, or ciphertext don't match — i.e. the blob was tampered with or
 *  is being opened under the wrong organizationId. */
async function open(sealed: string, rawKey: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const raw = fromBase64(sealed);
  const iv = raw.subarray(0, IV_BYTES);
  const ciphertext = raw.subarray(IV_BYTES);
  const key = await importAesGcmKey(rawKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export class EncryptedDbSecretProvider implements SecretProvider {
  private readonly rootKey: Uint8Array;

  constructor(masterKeyBase64: string) {
    const key = fromBase64(masterKeyBase64);
    if (key.length !== ROOT_KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_MASTER_KEY must decode (base64) to exactly ${ROOT_KEY_BYTES} bytes — got ${key.length}. Generate one with: openssl rand -base64 32`,
      );
    }
    this.rootKey = key;
  }

  async encrypt(plaintext: Record<string, unknown>, context: EncryptionContext): Promise<string> {
    const dataKey = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));
    const aad = new TextEncoder().encode(context.organizationId);

    const payload = await seal(
      new TextEncoder().encode(JSON.stringify(plaintext)),
      dataKey,
      aad,
    );
    const wrappedDataKey = await seal(dataKey, this.rootKey, aad);

    const blob: EnvelopeBlob = { v: ENVELOPE_VERSION, wrappedDataKey, payload };
    return toBase64(new TextEncoder().encode(JSON.stringify(blob)));
  }

  async decrypt(
    ciphertext: string,
    context: EncryptionContext,
  ): Promise<Record<string, unknown>> {
    let blob: EnvelopeBlob;
    try {
      blob = JSON.parse(new TextDecoder().decode(fromBase64(ciphertext)));
    } catch {
      throw new Error("Malformed credential ciphertext");
    }
    if (blob.v !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported credential envelope version: ${blob.v}`);
    }

    const aad = new TextEncoder().encode(context.organizationId);
    const dataKey = await open(blob.wrappedDataKey, this.rootKey, aad);
    const plaintext = await open(blob.payload, dataKey, aad);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}
