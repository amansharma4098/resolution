import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditLogEntry, AuditLogWriter } from "@resolution/security";

/**
 * Adapts a real PrismaClient to the structural AuditLogWriter interface that
 * @resolution/security's writeAuditLog() expects. @resolution/security deliberately does
 * not import Prisma's generated types (so packages/agents and apps/worker can write audit
 * entries without depending on the database package's generated client at the type level,
 * and so tests can pass an in-memory fake) — this is the one place that bridges the two,
 * via an explicit object-literal mapping rather than a structural cast, since Prisma's
 * generated Checked/Unchecked create-input union does not structurally match a plain
 * named interface.
 */
export function auditLogWriter(db: PrismaClient): AuditLogWriter {
  return {
    auditLog: {
      async create({ data }: { data: AuditLogEntry }) {
        return db.auditLog.create({
          data: {
            organizationId: data.organizationId ?? undefined,
            actorType: data.actorType,
            actorId: data.actorId ?? undefined,
            action: data.action,
            targetType: data.targetType ?? undefined,
            targetId: data.targetId ?? undefined,
            requestId: data.requestId ?? undefined,
            metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
      },
    },
  };
}
