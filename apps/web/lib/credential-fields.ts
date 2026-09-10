/**
 * Client-side field definitions for building the credential payload form — presentation
 * only. The authoritative shape validation happens server-side against
 * packages/credentials/src/credential-payload.ts; this just has to agree with it closely
 * enough to produce a payload the API will accept, not enforce correctness itself.
 */
export const AUTHENTICATION_TYPES = [
  "API_KEY",
  "TOKEN",
  "BASIC_AUTH",
  "CLIENT_SECRET",
  "SERVICE_PRINCIPAL",
  "OAUTH",
  "CUSTOM",
] as const;

export type AuthenticationType = (typeof AUTHENTICATION_TYPES)[number];

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
}

export const CREDENTIAL_FIELDS: Record<Exclude<AuthenticationType, "CUSTOM">, CredentialField[]> = {
  API_KEY: [{ key: "apiKey", label: "API key", secret: true }],
  TOKEN: [{ key: "token", label: "Token", secret: true }],
  BASIC_AUTH: [
    { key: "username", label: "Username", secret: false },
    { key: "password", label: "Password", secret: true },
  ],
  CLIENT_SECRET: [
    { key: "clientId", label: "Client ID", secret: false },
    { key: "clientSecret", label: "Client secret", secret: true },
    { key: "tenantId", label: "Tenant ID", secret: false, optional: true },
  ],
  SERVICE_PRINCIPAL: [
    { key: "tenantId", label: "Tenant ID", secret: false },
    { key: "clientId", label: "Client ID", secret: false },
    { key: "clientSecret", label: "Client secret", secret: true },
  ],
  OAUTH: [
    { key: "accessToken", label: "Access token", secret: true },
    { key: "refreshToken", label: "Refresh token", secret: true, optional: true },
  ],
};
