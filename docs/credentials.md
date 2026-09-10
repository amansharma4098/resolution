# Credentials

A `Credential` is created once per organization and reused across any number of Map
Servers or Integrations — a customer never re-enters a secret. See ARCHITECTURE.md §5 for
the data shape and `packages/credentials/` for the implementation.

## The SecretProvider interface

```typescript
// packages/credentials/src/secret-provider.ts
export interface SecretProvider {
  encrypt(plaintext: Record<string, unknown>, context: { organizationId: string }): Promise<string>;
  decrypt(ciphertext: string, context: { organizationId: string }): Promise<Record<string, unknown>>;
}
```

Two methods, nothing else. Every caller (apps/api's credential routes today; a Map Server's
own client code once it needs to decrypt for a live call, from Phase 5 on) goes through
this interface — never a concrete provider class directly — so swapping the backend never
touches a caller.

## EncryptedDbSecretProvider (default, implemented)

Real envelope encryption, entirely within Postgres, no external KMS required:

1. Each credential gets its own random 256-bit **data key**.
2. The data key encrypts the plaintext payload (AES-256-GCM).
3. The data key itself is encrypted ("wrapped") by the deployment's **root key**
   (`ENCRYPTION_MASTER_KEY`, AES-256-GCM).
4. Both layers use the credential's `organizationId` as **additional authenticated data
   (AAD)** — decryption fails closed (throws) if the ciphertext is tampered with, or if
   it's ever decrypted under a different org's context. This is a real defense-in-depth
   property, not just a comment: even a repository-layer bug that let the wrong row
   through would still fail to decrypt.

The serialized blob (`{ v, wrappedDataKey, payload }`, each a base64 `iv | authTag |
ciphertext`) is what's stored in `Credential.encryptedData`. Generate a root key with:

```bash
openssl rand -base64 32
```

Set it as `ENCRYPTION_MASTER_KEY`. The `.env.example` default is a fixed, publicly-known
value — fine for local dev only, never for a real deployment (same treatment as
`JWT_SECRET`'s default).

## Cloud providers (interface designed for, not implemented yet)

`AWS_SECRETS_MANAGER`, `AZURE_KEY_VAULT`, `GCP_SECRET_MANAGER` are valid `SECRET_PROVIDER`
values in the schema and the factory function (`packages/credentials/src/factory.ts`) — but
selecting one currently throws a clear error rather than pretending to work. They're
tracked for Phase 12 (production hardening) in `IMPLEMENTATION_PLAN.md`. Implementing one
means adding a class satisfying `SecretProvider` and wiring it into the `switch` in
`factory.ts` — no caller changes.

## Payload shapes

One shape per `authenticationType`, validated with Zod before anything is ever encrypted —
`packages/credentials/src/credential-payload.ts`:

| authenticationType | payload fields |
|---|---|
| `API_KEY` | `apiKey` |
| `TOKEN` | `token` |
| `BASIC_AUTH` | `username`, `password` |
| `CLIENT_SECRET` | `clientId`, `clientSecret`, `tenantId?` |
| `SERVICE_PRINCIPAL` | `tenantId`, `clientId`, `clientSecret` |
| `OAUTH` | `accessToken`, `refreshToken?`, `expiresAt?` |
| `CUSTOM` | any non-empty set of string fields |

## What the API returns

Never the plaintext, never `encryptedData` — only:

```json
{ "id": "...", "name": "...", "provider": "...", "authenticationType": "API_KEY",
  "status": "VALID", "lastValidatedAt": "...", "maskedHint": "••••1234" }
```

`maskedHint` is derived from the plaintext at the one moment it's in hand (create/rotate)
and is never stored — list/get return a generic `••••••••` rather than re-decrypting every
row just to compute a display hint.

## Test vs. real connectivity

`POST /api/credentials/:id/test` (Phase 2) verifies the stored blob still decrypts and
still matches its `authenticationType`'s shape — a real check, but a structural one, not a
live call to the provider. A credential is provider-agnostic and may be attached to several
Map Servers, so it has no single "connection" of its own. Live connectivity testing happens
through a Map Server's `authAdapter.testConnection()` once one references the credential
(`POST /api/map-servers/:id/test`) — see `docs/map-server.md`.
