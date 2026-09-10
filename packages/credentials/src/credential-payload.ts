import { z } from "zod";

/**
 * One secret-payload shape per AuthenticationType (matches the Prisma enum in
 * packages/database/prisma/schema.prisma). This is what a client sends when creating or
 * rotating a credential — apps/api validates against this before ever calling
 * SecretProvider.encrypt(), so a malformed payload never reaches encryption at all.
 */
export const CredentialPayloadSchemas = {
  OAUTH: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
  API_KEY: z.object({
    apiKey: z.string().min(1),
  }),
  CLIENT_SECRET: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    tenantId: z.string().optional(),
  }),
  SERVICE_PRINCIPAL: z.object({
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
  BASIC_AUTH: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  TOKEN: z.object({
    token: z.string().min(1),
  }),
  // CUSTOM covers a provider whose auth doesn't fit the other shapes — at least one
  // non-empty field, everything string-valued (no nested objects) so it stays displayable.
  CUSTOM: z
    .record(z.string().min(1))
    .refine((fields) => Object.keys(fields).length > 0, {
      message: "CUSTOM credentials require at least one field",
    }),
} as const;

export type AuthenticationType = keyof typeof CredentialPayloadSchemas;

export function validateCredentialPayload(
  type: AuthenticationType,
  payload: unknown,
): Record<string, unknown> {
  return CredentialPayloadSchemas[type].parse(payload);
}

const PRIMARY_FIELD: Record<AuthenticationType, string | null> = {
  OAUTH: "accessToken",
  API_KEY: "apiKey",
  CLIENT_SECRET: "clientSecret",
  SERVICE_PRINCIPAL: "clientSecret",
  BASIC_AUTH: "password",
  TOKEN: "token",
  CUSTOM: null,
};

/** A short, display-safe hint derived from the payload — never the secret itself, and
 *  never long enough to be useful for guessing it. Used for the masked credential shape
 *  the API returns (ARCHITECTURE.md §5: a credential's secret is never returned to the
 *  frontend after creation). */
export function maskedHintFor(type: AuthenticationType, payload: Record<string, unknown>): string {
  const field = PRIMARY_FIELD[type];
  const value = field ? String(payload[field] ?? "") : "";
  const tail = value.slice(-4);
  return tail.length === 4 ? `••••${tail}` : "••••••••";
}
