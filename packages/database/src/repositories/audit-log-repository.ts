import type { PrismaClient } from "@prisma/client";
import { TenantScopedRepository } from "../tenant-scoped-repository";
import { parseJsonField } from "../json-field";

export interface AuditLogRow {
  id: string;
  organizationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function toPublic(row: {
  id: string;
  organizationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: string;
  createdAt: Date;
}): AuditLogRow {
  return { ...row, metadata: parseJsonField(row.metadata, {}) };
}

/** Same tenant-isolation contract as the other TenantScopedRepositorys — see
 *  CredentialRepository's header comment. Read-only: audit entries are never edited or
 *  deleted through the app (ARCHITECTURE.md §11 — the log is the record). */
export class AuditLogRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    organizationId: string,
  ) {
    super(organizationId);
  }

  /** Most-recent-first, cursor-paginated on `createdAt` (the column the schema's
   *  `@@index([organizationId, createdAt])` covers) — `before` is the `createdAt` of the
   *  last row of the previous page, not an offset, so pages stay stable under concurrent
   *  writes. */
  async list(opts: { limit: number; before?: Date }): Promise<AuditLogRow[]> {
    const rows = await this.db.auditLog.findMany({
      where: { ...this.scope(), ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: opts.limit,
    });
    return rows.map(toPublic);
  }
}
