/**
 * A single write path for AuditLog rows, used by every route/agent action that mutates
 * state or touches a credential — ARCHITECTURE.md §11 requires an audit entry on every AI
 * and user action. Takes a minimal structural type for the Prisma client (rather than
 * importing @resolution/database's generated client directly) so packages/agents and
 * apps/worker can log without a hard dependency, and so tests can pass an in-memory fake.
 */
export interface AuditLogWriter {
  auditLog: {
    // Method-shorthand (not an arrow-typed property) so TS checks this structurally
    // against Prisma's generated `create` signature bivariantly — Prisma's JSON input
    // type doesn't structurally accept a plain `Record<string, unknown>` under strict
    // property-function variance, but does under method variance. See the accompanying
    // test for the concrete shape this must accept.
    create(args: { data: AuditLogEntry }): Promise<unknown>;
  };
}

export interface AuditLogEntry {
  // Nullable: account-level events (signup, login) have no organization yet.
  organizationId?: string | null;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Fields that must never be persisted to an audit log's `metadata`, even accidentally by a
 * caller spreading a raw object — ARCHITECTURE.md §11: never log secrets/tokens/passwords.
 */
const SENSITIVE_METADATA_KEYS = new Set([
  "password",
  "passwordHash",
  "encryptedData",
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "token",
  "secret",
]);

function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    clean[key] = SENSITIVE_METADATA_KEYS.has(key) ? "[REDACTED]" : value;
  }
  return clean;
}

export async function writeAuditLog(db: AuditLogWriter, entry: AuditLogEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      ...entry,
      metadata: redact(entry.metadata ?? {}),
    },
  });
}
