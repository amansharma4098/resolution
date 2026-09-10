/**
 * ARCHITECTURE.md §5. A credential's secret payload never touches the frontend after
 * creation and is only ever decrypted inside the process that needs it (a Map Server's own
 * client — see docs/map-server.md). `organizationId` is passed on every call and — in
 * `EncryptedDbSecretProvider` — is bound into the ciphertext itself (as AAD), so a
 * credential encrypted for one org cannot be decrypted under another org's context even if
 * a repository-layer bug ever let the wrong row through.
 */
export interface EncryptionContext {
  organizationId: string;
}

export interface SecretProvider {
  encrypt(plaintext: Record<string, unknown>, context: EncryptionContext): Promise<string>;
  decrypt(ciphertext: string, context: EncryptionContext): Promise<Record<string, unknown>>;
}
