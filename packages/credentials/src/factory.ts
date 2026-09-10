import { EncryptedDbSecretProvider } from "./encrypted-db-secret-provider";
import type { SecretProvider } from "./secret-provider";

export type SecretProviderKind =
  | "ENCRYPTED_DB"
  | "AWS_SECRETS_MANAGER"
  | "AZURE_KEY_VAULT"
  | "GCP_SECRET_MANAGER";

export interface SecretProviderConfig {
  masterKey?: string;
}

/**
 * The one switch point for ARCHITECTURE.md §5's "select via SECRET_PROVIDER env var, same
 * interface, swappable without touching callers" — apps/api/apps/worker call this once at
 * boot, never construct a provider class directly.
 */
export function createSecretProvider(
  kind: SecretProviderKind,
  config: SecretProviderConfig,
): SecretProvider {
  switch (kind) {
    case "ENCRYPTED_DB":
      if (!config.masterKey) {
        throw new Error("ENCRYPTION_MASTER_KEY is required for the ENCRYPTED_DB secret provider");
      }
      return new EncryptedDbSecretProvider(config.masterKey);
    case "AWS_SECRETS_MANAGER":
    case "AZURE_KEY_VAULT":
    case "GCP_SECRET_MANAGER":
      throw new Error(
        `SecretProvider "${kind}" is not implemented yet (tracked for Phase 12 — production ` +
          `hardening, see IMPLEMENTATION_PLAN.md). Use SECRET_PROVIDER=ENCRYPTED_DB for now.`,
      );
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown SECRET_PROVIDER "${exhaustive}"`);
    }
  }
}
