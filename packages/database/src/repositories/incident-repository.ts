import type { PrismaClient } from "@prisma/client";
import type { IncidentSourceType, IncidentStatus, Priority, Severity } from "@resolution/shared";
import { TenantScopedRepository } from "../tenant-scoped-repository";
import { parseJsonField, serializeJsonField } from "../json-field";

export interface CreateIncidentInput {
  integrationId?: string;
  externalId: string;
  source: IncidentSourceType;
  title: string;
  description: string;
  severity: Severity;
  priority: Priority;
  status: IncidentStatus;
  service?: string;
  environment?: string;
  resource?: string;
  affectedSystem?: string;
  metadata: Record<string, unknown>;
}

/** The shape repository callers see — `metadata` parsed back from its underlying JSON-text
 *  String column; see packages/database/src/json-field.ts. */
export interface Incident {
  id: string;
  tenantId: string;
  integrationId: string | null;
  externalId: string;
  source: IncidentSourceType;
  title: string;
  description: string;
  severity: Severity;
  priority: Priority;
  status: IncidentStatus;
  service: string | null;
  environment: string | null;
  resource: string | null;
  affectedSystem: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

function toPublic(row: {
  id: string;
  tenantId: string;
  integrationId: string | null;
  externalId: string;
  source: string;
  title: string;
  description: string;
  severity: string;
  priority: string;
  status: string;
  service: string | null;
  environment: string | null;
  resource: string | null;
  affectedSystem: string | null;
  metadata: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}): Incident {
  return {
    ...row,
    source: row.source as IncidentSourceType,
    severity: row.severity as Severity,
    priority: row.priority as Priority,
    status: row.status as IncidentStatus,
    metadata: parseJsonField(row.metadata, {}),
  };
}

/** Same tenant-isolation contract as CredentialRepository — see its header comment. */
export class IncidentRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    tenantId: string,
  ) {
    super(tenantId);
  }

  async create(input: CreateIncidentInput): Promise<Incident> {
    const row = await this.db.incident.create({
      data: {
        ...input,
        metadata: serializeJsonField(input.metadata),
        tenantId: this.tenantId,
      },
    });
    return toPublic(row);
  }

  /** The idempotency check for incident ingestion (ARCHITECTURE.md §10) — the same
   *  external issue re-delivered by a webhook retry must never create a duplicate
   *  Incident row. Matches the `@@unique([tenantId, source, externalId])`
   *  constraint on the Incident model. */
  async findByExternalId(source: IncidentSourceType, externalId: string): Promise<Incident | null> {
    const row = await this.db.incident.findUnique({
      where: {
        tenantId_source_externalId: { tenantId: this.tenantId, source, externalId },
      },
    });
    return row ? toPublic(row) : null;
  }

  async list(): Promise<Incident[]> {
    const rows = await this.db.incident.findMany({
      where: this.scope(),
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPublic);
  }

  async findById(id: string): Promise<Incident | null> {
    const row = await this.db.incident.findFirst({ where: { ...this.scope(), id } });
    return row ? toPublic(row) : null;
  }
}
