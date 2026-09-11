import { randomUUID } from "node:crypto";

/**
 * A minimal in-memory stand-in for PrismaClient, covering only the calls the repositories
 * in packages/database/src/repositories actually make. Lets apps/api's route tests run
 * without a live Postgres — full repository behavior (real SQL, constraints, cascades) is
 * covered separately once integration tests run against the docker-compose Postgres in CI
 * (see IMPLEMENTATION_PLAN.md).
 */
export interface FakeUser {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeOrganization {
  id: string;
  name: string;
  slug: string;
  resolutionMode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface FakeCredential {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  authenticationType: string;
  encryptedData: string;
  status: string;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeMapServer {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  credentialId: string | null;
  environments: string[];
  config: Record<string, unknown>;
  isMock: boolean;
  status: string;
  lastHealthCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeMapServerCapability {
  id: string;
  mapServerId: string;
  key: string;
  enabled: boolean;
  riskLevel: string;
  mutating: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeIntegration {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  credentialId: string | null;
  config: Record<string, unknown>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeIncident {
  id: string;
  organizationId: string;
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
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface FakeIncidentEvent {
  id: string;
  incidentId: string;
  type: string;
  actor: string;
  detail: string;
  createdAt: Date;
}

export interface FakeIncidentEvidence {
  id: string;
  incidentId: string;
  type: string;
  source: string;
  capabilityKey: string | null;
  summary: string;
  payload: string;
  collectedAt: Date;
}

export interface FakeRootCauseAnalysis {
  id: string;
  incidentId: string;
  summary: string;
  claims: string;
  confidence: number;
  alternativeHypotheses: string;
  createdAt: Date;
}

export interface FakeAutomationPolicy {
  id: string;
  organizationId: string;
  mapServerType: string;
  capabilityKey: string;
  riskLevel: string;
  behavior: string;
  resolutionModeFloor: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeResolution {
  id: string;
  incidentId: string;
  rcaId: string;
  proposedAction: string;
  mapServerId: string | null;
  capabilityKey: string | null;
  input: string;
  riskLevel: string;
  createdAt: Date;
}

export interface FakeRemediationAction {
  id: string;
  resolutionId: string;
  status: string;
  idempotencyKey: string;
  executedAt: Date | null;
  result: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeApproval {
  id: string;
  remediationActionId: string;
  status: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  reason: string | null;
}

export interface FakeVerification {
  id: string;
  remediationActionId: string;
  status: string;
  expectedState: string;
  actualState: string;
  attempt: number;
  checkedAt: Date;
}

export interface FakeWebhookEvent {
  id: string;
  organizationId: string | null;
  source: string;
  externalId: string;
  eventHash: string;
  payload: string;
  processedAt: Date | null;
  createdAt: Date;
}

interface OrgScopedWhere {
  organizationId: string;
  id?: string;
}

/** Shared behavior for the three org-scoped, repository-backed collections below — create,
 *  list (org-filtered), findFirst (org+id filtered, mirroring TenantScopedRepository),
 *  update, delete. */
function fakeTenantCollection<T extends { id: string; organizationId: string }>(rows: T[]) {
  return {
    async findMany({ where }: { where: { organizationId: string } }) {
      return rows.filter((r) => r.organizationId === where.organizationId);
    },
    async findFirst({ where }: { where: OrgScopedWhere }) {
      return rows.find((r) => r.organizationId === where.organizationId && r.id === where.id) ?? null;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<T> }) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`fake row ${where.id} not found`);
      Object.assign(row, data);
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error(`fake row ${where.id} not found`);
      return rows.splice(idx, 1)[0]!;
    },
  };
}

export interface FakeDb {
  user: {
    findUnique(args: { where: { email?: string; id?: string } }): Promise<FakeUser | null>;
    create(args: { data: Partial<FakeUser> }): Promise<FakeUser>;
  };
  organization: {
    create(args: { data: Partial<FakeOrganization> }): Promise<FakeOrganization>;
    findUnique(args: { where: { id?: string; slug?: string } }): Promise<FakeOrganization | null>;
    update(args: { where: { id: string }; data: Partial<FakeOrganization> }): Promise<FakeOrganization>;
  };
  organizationMember: {
    create(args: { data: Partial<FakeMembership> }): Promise<FakeMembership>;
    findMany(args: {
      where: { userId?: string; organizationId?: string };
      include?: { organization?: boolean; user?: boolean };
    }): Promise<
      (FakeMembership & { organization?: FakeOrganization; user?: FakeUser })[]
    >;
    findUnique(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }): Promise<FakeMembership | null>;
    count(args: { where: { organizationId: string; role: string } }): Promise<number>;
    update(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
      data: Partial<FakeMembership>;
    }): Promise<FakeMembership>;
    delete(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }): Promise<FakeMembership>;
  };
  credential: {
    create(args: { data: Partial<FakeCredential> }): Promise<FakeCredential>;
    findMany(args: { where: { organizationId: string } }): Promise<FakeCredential[]>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeCredential | null>;
    update(args: { where: { id: string }; data: Partial<FakeCredential> }): Promise<FakeCredential>;
    delete(args: { where: { id: string } }): Promise<FakeCredential>;
  };
  mapServer: {
    create(args: { data: Partial<FakeMapServer> }): Promise<FakeMapServer>;
    findMany(args: { where: { organizationId: string } }): Promise<FakeMapServer[]>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeMapServer | null>;
    update(args: { where: { id: string }; data: Partial<FakeMapServer> }): Promise<FakeMapServer>;
    delete(args: { where: { id: string } }): Promise<FakeMapServer>;
  };
  mapServerCapability: {
    create(args: { data: Partial<FakeMapServerCapability> }): Promise<FakeMapServerCapability>;
    findMany(args: { where: { mapServerId: string } }): Promise<FakeMapServerCapability[]>;
    findUnique(args: {
      where: { mapServerId_key: { mapServerId: string; key: string } };
    }): Promise<FakeMapServerCapability | null>;
    update(args: {
      where: { mapServerId_key: { mapServerId: string; key: string } };
      data: Partial<FakeMapServerCapability>;
    }): Promise<FakeMapServerCapability>;
  };
  integration: {
    create(args: { data: Partial<FakeIntegration> }): Promise<FakeIntegration>;
    findMany(args: { where: { organizationId: string } }): Promise<FakeIntegration[]>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeIntegration | null>;
    findUnique(args: { where: { id: string } }): Promise<FakeIntegration | null>;
    update(args: { where: { id: string }; data: Partial<FakeIntegration> }): Promise<FakeIntegration>;
    delete(args: { where: { id: string } }): Promise<FakeIntegration>;
  };
  incident: {
    create(args: { data: Partial<FakeIncident> }): Promise<FakeIncident>;
    findMany(args: { where: { organizationId: string } }): Promise<FakeIncident[]>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeIncident | null>;
    findUnique(args: {
      where: {
        organizationId_source_externalId: { organizationId: string; source: string; externalId: string };
      };
    }): Promise<FakeIncident | null>;
    update(args: { where: { id: string }; data: Partial<FakeIncident> }): Promise<FakeIncident>;
  };
  incidentEvent: {
    create(args: { data: Partial<FakeIncidentEvent> }): Promise<FakeIncidentEvent>;
    findMany(args: {
      where: { incidentId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<FakeIncidentEvent[]>;
  };
  incidentEvidence: {
    create(args: { data: Partial<FakeIncidentEvidence> }): Promise<FakeIncidentEvidence>;
    findMany(args: {
      where: { incidentId: string };
      orderBy?: { collectedAt: "asc" | "desc" };
    }): Promise<FakeIncidentEvidence[]>;
  };
  rootCauseAnalysis: {
    create(args: { data: Partial<FakeRootCauseAnalysis> }): Promise<FakeRootCauseAnalysis>;
    findFirst(args: {
      where: { incidentId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<FakeRootCauseAnalysis | null>;
  };
  automationPolicy: {
    findMany(args: { where: { organizationId: string } }): Promise<FakeAutomationPolicy[]>;
    findUnique(args: {
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: string;
          mapServerType: string;
          capabilityKey: string;
        };
      };
    }): Promise<FakeAutomationPolicy | null>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeAutomationPolicy | null>;
    upsert(args: {
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: string;
          mapServerType: string;
          capabilityKey: string;
        };
      };
      create: Partial<FakeAutomationPolicy>;
      update: Partial<FakeAutomationPolicy>;
    }): Promise<FakeAutomationPolicy>;
    delete(args: { where: { id: string } }): Promise<FakeAutomationPolicy>;
  };
  resolution: {
    create(args: { data: Partial<FakeResolution> }): Promise<FakeResolution>;
    findUnique(args: { where: { id: string } }): Promise<FakeResolution | null>;
    findMany(args: {
      where: { incidentId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<FakeResolution[]>;
  };
  remediationAction: {
    create(args: { data: Partial<FakeRemediationAction> }): Promise<FakeRemediationAction>;
    findUnique(args: { where: { id: string } }): Promise<FakeRemediationAction | null>;
    findMany(args: { where: { resolutionId: string } }): Promise<FakeRemediationAction[]>;
    update(args: {
      where: { id: string };
      data: Partial<FakeRemediationAction>;
    }): Promise<FakeRemediationAction>;
  };
  approval: {
    create(args: { data: Partial<FakeApproval> }): Promise<FakeApproval>;
    findUnique(args: { where: { id?: string; remediationActionId?: string } }): Promise<FakeApproval | null>;
    update(args: { where: { id: string }; data: Partial<FakeApproval> }): Promise<FakeApproval>;
  };
  verification: {
    create(args: { data: Partial<FakeVerification> }): Promise<FakeVerification>;
    findMany(args: {
      where: { remediationActionId: string };
      orderBy?: { checkedAt: "asc" | "desc" };
    }): Promise<FakeVerification[]>;
  };
  webhookEvent: {
    create(args: { data: Partial<FakeWebhookEvent> }): Promise<FakeWebhookEvent>;
    findUnique(args: {
      where: { source_externalId_eventHash: { source: string; externalId: string; eventHash: string } };
    }): Promise<FakeWebhookEvent | null>;
  };
  auditLog: {
    create(args: { data: unknown }): Promise<unknown>;
  };
  $transaction<T extends readonly unknown[]>(ops: readonly [...T]): Promise<T>;
  $disconnect(): Promise<void>;
  _debug: {
    users: FakeUser[];
    organizations: FakeOrganization[];
    memberships: FakeMembership[];
    credentials: FakeCredential[];
    mapServers: FakeMapServer[];
    mapServerCapabilities: FakeMapServerCapability[];
    integrations: FakeIntegration[];
    incidents: FakeIncident[];
    incidentEvents: FakeIncidentEvent[];
    incidentEvidence: FakeIncidentEvidence[];
    rootCauseAnalyses: FakeRootCauseAnalysis[];
    automationPolicies: FakeAutomationPolicy[];
    resolutions: FakeResolution[];
    remediationActions: FakeRemediationAction[];
    approvals: FakeApproval[];
    verifications: FakeVerification[];
    webhookEvents: FakeWebhookEvent[];
    auditLogs: unknown[];
  };
}

export function createFakeDb(): FakeDb {
  const users: FakeUser[] = [];
  const organizations: FakeOrganization[] = [];
  const memberships: FakeMembership[] = [];
  const credentials: FakeCredential[] = [];
  const mapServers: FakeMapServer[] = [];
  const mapServerCapabilities: FakeMapServerCapability[] = [];
  const integrations: FakeIntegration[] = [];
  const incidents: FakeIncident[] = [];
  const incidentEvents: FakeIncidentEvent[] = [];
  const incidentEvidence: FakeIncidentEvidence[] = [];
  const rootCauseAnalyses: FakeRootCauseAnalysis[] = [];
  const automationPolicies: FakeAutomationPolicy[] = [];
  const resolutions: FakeResolution[] = [];
  const remediationActions: FakeRemediationAction[] = [];
  const approvals: FakeApproval[] = [];
  const verifications: FakeVerification[] = [];
  const webhookEvents: FakeWebhookEvent[] = [];
  const auditLogs: unknown[] = [];

  const db: FakeDb = {
    user: {
      async findUnique({ where }: { where: { email?: string; id?: string } }) {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        return null;
      },
      async create({ data }: { data: Partial<FakeUser> }) {
        const user: FakeUser = {
          id: randomUUID(),
          email: data.email!,
          name: data.name ?? null,
          passwordHash: data.passwordHash ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.push(user);
        return user;
      },
    },
    organization: {
      async create({ data }: { data: Partial<FakeOrganization> }) {
        const org: FakeOrganization = {
          id: data.id ?? randomUUID(),
          name: data.name!,
          slug: data.slug!,
          resolutionMode: "OBSERVE_ONLY",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        organizations.push(org);
        return org;
      },
      async findUnique({ where }: { where: { id?: string; slug?: string } }) {
        if (where.id) return organizations.find((o) => o.id === where.id) ?? null;
        if (where.slug) return organizations.find((o) => o.slug === where.slug) ?? null;
        return null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<FakeOrganization> }) {
        const row = organizations.find((o) => o.id === where.id);
        if (!row) throw new Error(`fake organization ${where.id} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    organizationMember: {
      async create({ data }: { data: Partial<FakeMembership> }) {
        const membership: FakeMembership = {
          id: randomUUID(),
          organizationId: data.organizationId!,
          userId: data.userId!,
          role: data.role ?? "MEMBER",
          createdAt: new Date(),
        };
        memberships.push(membership);
        return membership;
      },
      async findMany({
        where,
        include,
      }: {
        where: { userId?: string; organizationId?: string };
        include?: { organization?: boolean; user?: boolean };
      }) {
        return memberships
          .filter(
            (m) =>
              (where.userId === undefined || m.userId === where.userId) &&
              (where.organizationId === undefined || m.organizationId === where.organizationId),
          )
          .map((m) => ({
            ...m,
            ...(include?.organization
              ? { organization: organizations.find((o) => o.id === m.organizationId)! }
              : {}),
            ...(include?.user ? { user: users.find((u) => u.id === m.userId)! } : {}),
          }));
      },
      async findUnique({
        where,
      }: {
        where: { organizationId_userId: { organizationId: string; userId: string } };
      }) {
        const { organizationId, userId } = where.organizationId_userId;
        return (
          memberships.find((m) => m.organizationId === organizationId && m.userId === userId) ??
          null
        );
      },
      async count({ where }: { where: { organizationId: string; role: string } }) {
        return memberships.filter((m) => m.organizationId === where.organizationId && m.role === where.role)
          .length;
      },
      async update({
        where,
        data,
      }: {
        where: { organizationId_userId: { organizationId: string; userId: string } };
        data: Partial<FakeMembership>;
      }) {
        const { organizationId, userId } = where.organizationId_userId;
        const membership = memberships.find((m) => m.organizationId === organizationId && m.userId === userId);
        if (!membership) throw new Error("fake membership not found");
        Object.assign(membership, data);
        return membership;
      },
      async delete({
        where,
      }: {
        where: { organizationId_userId: { organizationId: string; userId: string } };
      }) {
        const { organizationId, userId } = where.organizationId_userId;
        const idx = memberships.findIndex((m) => m.organizationId === organizationId && m.userId === userId);
        if (idx === -1) throw new Error("fake membership not found");
        return memberships.splice(idx, 1)[0]!;
      },
    },
    credential: {
      ...fakeTenantCollection(credentials),
      async create({ data }: { data: Partial<FakeCredential> }) {
        const row: FakeCredential = {
          id: randomUUID(),
          organizationId: data.organizationId!,
          name: data.name!,
          provider: data.provider!,
          authenticationType: data.authenticationType!,
          encryptedData: data.encryptedData!,
          status: data.status ?? "UNVERIFIED",
          lastValidatedAt: data.lastValidatedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        credentials.push(row);
        return row;
      },
    },
    mapServer: {
      ...fakeTenantCollection(mapServers),
      async create({ data }: { data: Partial<FakeMapServer> }) {
        const row: FakeMapServer = {
          id: randomUUID(),
          organizationId: data.organizationId!,
          type: data.type!,
          name: data.name!,
          credentialId: data.credentialId ?? null,
          environments: data.environments ?? [],
          config: data.config ?? {},
          isMock: data.isMock ?? false,
          status: data.status ?? "UNCONFIGURED",
          lastHealthCheckAt: data.lastHealthCheckAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mapServers.push(row);
        return row;
      },
    },
    mapServerCapability: {
      async create({ data }: { data: Partial<FakeMapServerCapability> }) {
        const row: FakeMapServerCapability = {
          id: randomUUID(),
          mapServerId: data.mapServerId!,
          key: data.key!,
          enabled: data.enabled ?? false,
          riskLevel: data.riskLevel!,
          mutating: data.mutating ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mapServerCapabilities.push(row);
        return row;
      },
      async findMany({ where }: { where: { mapServerId: string } }) {
        return mapServerCapabilities.filter((c) => c.mapServerId === where.mapServerId);
      },
      async findUnique({
        where,
      }: {
        where: { mapServerId_key: { mapServerId: string; key: string } };
      }) {
        const { mapServerId, key } = where.mapServerId_key;
        return mapServerCapabilities.find((c) => c.mapServerId === mapServerId && c.key === key) ?? null;
      },
      async update({
        where,
        data,
      }: {
        where: { mapServerId_key: { mapServerId: string; key: string } };
        data: Partial<FakeMapServerCapability>;
      }) {
        const { mapServerId, key } = where.mapServerId_key;
        const row = mapServerCapabilities.find((c) => c.mapServerId === mapServerId && c.key === key);
        if (!row) throw new Error("fake capability not found");
        Object.assign(row, data);
        return row;
      },
    },
    integration: {
      ...fakeTenantCollection(integrations),
      async create({ data }: { data: Partial<FakeIntegration> }) {
        const row: FakeIntegration = {
          id: randomUUID(),
          organizationId: data.organizationId!,
          type: data.type!,
          name: data.name!,
          credentialId: data.credentialId ?? null,
          config: data.config ?? {},
          status: data.status ?? "UNCONFIGURED",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        integrations.push(row);
        return row;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return integrations.find((i) => i.id === where.id) ?? null;
      },
    },
    incident: {
      async create({ data }: { data: Partial<FakeIncident> }) {
        const row: FakeIncident = {
          id: randomUUID(),
          organizationId: data.organizationId!,
          integrationId: data.integrationId ?? null,
          externalId: data.externalId!,
          source: data.source!,
          title: data.title!,
          description: data.description!,
          severity: data.severity!,
          priority: data.priority!,
          status: data.status ?? "NEW",
          service: data.service ?? null,
          environment: data.environment ?? null,
          resource: data.resource ?? null,
          affectedSystem: data.affectedSystem ?? null,
          metadata: data.metadata ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
        };
        incidents.push(row);
        return row;
      },
      async findMany({ where }: { where: { organizationId: string } }) {
        return incidents.filter((i) => i.organizationId === where.organizationId);
      },
      async findFirst({ where }: { where: OrgScopedWhere }) {
        return incidents.find((i) => i.organizationId === where.organizationId && i.id === where.id) ?? null;
      },
      async findUnique({
        where,
      }: {
        where: {
          organizationId_source_externalId: { organizationId: string; source: string; externalId: string };
        };
      }) {
        const { organizationId, source, externalId } = where.organizationId_source_externalId;
        return (
          incidents.find(
            (i) => i.organizationId === organizationId && i.source === source && i.externalId === externalId,
          ) ?? null
        );
      },
      async update({ where, data }: { where: { id: string }; data: Partial<FakeIncident> }) {
        const row = incidents.find((i) => i.id === where.id);
        if (!row) throw new Error(`fake incident ${where.id} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    incidentEvent: {
      async create({ data }: { data: Partial<FakeIncidentEvent> }) {
        const row: FakeIncidentEvent = {
          id: randomUUID(),
          incidentId: data.incidentId!,
          type: data.type!,
          actor: data.actor!,
          detail: data.detail ?? "{}",
          createdAt: new Date(),
        };
        incidentEvents.push(row);
        return row;
      },
      async findMany({
        where,
        orderBy,
      }: {
        where: { incidentId: string };
        orderBy?: { createdAt: "asc" | "desc" };
      }) {
        const rows = incidentEvents.filter((e) => e.incidentId === where.incidentId);
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        else rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return rows;
      },
    },
    incidentEvidence: {
      async create({ data }: { data: Partial<FakeIncidentEvidence> }) {
        const row: FakeIncidentEvidence = {
          id: randomUUID(),
          incidentId: data.incidentId!,
          type: data.type!,
          source: data.source!,
          capabilityKey: data.capabilityKey ?? null,
          summary: data.summary!,
          payload: data.payload ?? "{}",
          collectedAt: new Date(),
        };
        incidentEvidence.push(row);
        return row;
      },
      async findMany({
        where,
        orderBy,
      }: {
        where: { incidentId: string };
        orderBy?: { collectedAt: "asc" | "desc" };
      }) {
        const rows = incidentEvidence.filter((e) => e.incidentId === where.incidentId);
        if (orderBy?.collectedAt === "desc") rows.sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime());
        else rows.sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
        return rows;
      },
    },
    rootCauseAnalysis: {
      async create({ data }: { data: Partial<FakeRootCauseAnalysis> }) {
        const row: FakeRootCauseAnalysis = {
          id: randomUUID(),
          incidentId: data.incidentId!,
          summary: data.summary!,
          claims: data.claims ?? "[]",
          confidence: data.confidence!,
          alternativeHypotheses: data.alternativeHypotheses ?? "[]",
          createdAt: new Date(),
        };
        rootCauseAnalyses.push(row);
        return row;
      },
      async findFirst({
        where,
        orderBy,
      }: {
        where: { incidentId: string };
        orderBy?: { createdAt: "asc" | "desc" };
      }) {
        const rows = rootCauseAnalyses.filter((r) => r.incidentId === where.incidentId);
        rows.sort((a, b) =>
          orderBy?.createdAt === "asc"
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return rows[0] ?? null;
      },
    },
    automationPolicy: {
      async findMany({ where }: { where: { organizationId: string } }) {
        return automationPolicies.filter((p) => p.organizationId === where.organizationId);
      },
      async findUnique({
        where,
      }: {
        where: {
          organizationId_mapServerType_capabilityKey: {
            organizationId: string;
            mapServerType: string;
            capabilityKey: string;
          };
        };
      }) {
        const { organizationId, mapServerType, capabilityKey } = where.organizationId_mapServerType_capabilityKey;
        return (
          automationPolicies.find(
            (p) =>
              p.organizationId === organizationId &&
              p.mapServerType === mapServerType &&
              p.capabilityKey === capabilityKey,
          ) ?? null
        );
      },
      async findFirst({ where }: { where: OrgScopedWhere }) {
        return (
          automationPolicies.find((p) => p.organizationId === where.organizationId && p.id === where.id) ?? null
        );
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: {
          organizationId_mapServerType_capabilityKey: {
            organizationId: string;
            mapServerType: string;
            capabilityKey: string;
          };
        };
        create: Partial<FakeAutomationPolicy>;
        update: Partial<FakeAutomationPolicy>;
      }) {
        const { organizationId, mapServerType, capabilityKey } = where.organizationId_mapServerType_capabilityKey;
        const existing = automationPolicies.find(
          (p) =>
            p.organizationId === organizationId &&
            p.mapServerType === mapServerType &&
            p.capabilityKey === capabilityKey,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row: FakeAutomationPolicy = {
          id: randomUUID(),
          organizationId,
          mapServerType,
          capabilityKey,
          riskLevel: create.riskLevel!,
          behavior: create.behavior!,
          resolutionModeFloor: create.resolutionModeFloor!,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        automationPolicies.push(row);
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = automationPolicies.findIndex((p) => p.id === where.id);
        if (idx === -1) throw new Error(`fake automation policy ${where.id} not found`);
        return automationPolicies.splice(idx, 1)[0]!;
      },
    },
    resolution: {
      async create({ data }: { data: Partial<FakeResolution> }) {
        const row: FakeResolution = {
          id: randomUUID(),
          incidentId: data.incidentId!,
          rcaId: data.rcaId!,
          proposedAction: data.proposedAction!,
          mapServerId: data.mapServerId ?? null,
          capabilityKey: data.capabilityKey ?? null,
          input: data.input ?? "{}",
          riskLevel: data.riskLevel!,
          createdAt: new Date(),
        };
        resolutions.push(row);
        return row;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return resolutions.find((r) => r.id === where.id) ?? null;
      },
      async findMany({
        where,
        orderBy,
      }: {
        where: { incidentId: string };
        orderBy?: { createdAt: "asc" | "desc" };
      }) {
        const rows = resolutions.filter((r) => r.incidentId === where.incidentId);
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        else rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return rows;
      },
    },
    remediationAction: {
      async create({ data }: { data: Partial<FakeRemediationAction> }) {
        const row: FakeRemediationAction = {
          id: randomUUID(),
          resolutionId: data.resolutionId!,
          status: data.status ?? "PENDING",
          idempotencyKey: data.idempotencyKey!,
          executedAt: data.executedAt ?? null,
          result: data.result ?? "{}",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        remediationActions.push(row);
        return row;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return remediationActions.find((a) => a.id === where.id) ?? null;
      },
      async findMany({ where }: { where: { resolutionId: string } }) {
        return remediationActions.filter((a) => a.resolutionId === where.resolutionId);
      },
      async update({ where, data }: { where: { id: string }; data: Partial<FakeRemediationAction> }) {
        const row = remediationActions.find((a) => a.id === where.id);
        if (!row) throw new Error(`fake remediation action ${where.id} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    approval: {
      async create({ data }: { data: Partial<FakeApproval> }) {
        const row: FakeApproval = {
          id: randomUUID(),
          remediationActionId: data.remediationActionId!,
          status: data.status ?? "PENDING",
          requestedAt: new Date(),
          decidedAt: data.decidedAt ?? null,
          decidedByUserId: data.decidedByUserId ?? null,
          reason: data.reason ?? null,
        };
        approvals.push(row);
        return row;
      },
      async findUnique({ where }: { where: { id?: string; remediationActionId?: string } }) {
        if (where.id) return approvals.find((a) => a.id === where.id) ?? null;
        if (where.remediationActionId) {
          return approvals.find((a) => a.remediationActionId === where.remediationActionId) ?? null;
        }
        return null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<FakeApproval> }) {
        const row = approvals.find((a) => a.id === where.id);
        if (!row) throw new Error(`fake approval ${where.id} not found`);
        Object.assign(row, data);
        return row;
      },
    },
    verification: {
      async create({ data }: { data: Partial<FakeVerification> }) {
        const row: FakeVerification = {
          id: randomUUID(),
          remediationActionId: data.remediationActionId!,
          status: data.status!,
          expectedState: data.expectedState ?? "{}",
          actualState: data.actualState ?? "{}",
          attempt: data.attempt ?? 1,
          checkedAt: new Date(),
        };
        verifications.push(row);
        return row;
      },
      async findMany({
        where,
        orderBy,
      }: {
        where: { remediationActionId: string };
        orderBy?: { checkedAt: "asc" | "desc" };
      }) {
        const rows = verifications.filter((v) => v.remediationActionId === where.remediationActionId);
        if (orderBy?.checkedAt === "desc") rows.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
        else rows.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
        return rows;
      },
    },
    webhookEvent: {
      async create({ data }: { data: Partial<FakeWebhookEvent> }) {
        const row: FakeWebhookEvent = {
          id: randomUUID(),
          organizationId: data.organizationId ?? null,
          source: data.source!,
          externalId: data.externalId!,
          eventHash: data.eventHash!,
          payload: data.payload!,
          processedAt: data.processedAt ?? null,
          createdAt: new Date(),
        };
        webhookEvents.push(row);
        return row;
      },
      async findUnique({
        where,
      }: {
        where: { source_externalId_eventHash: { source: string; externalId: string; eventHash: string } };
      }) {
        const { source, externalId, eventHash } = where.source_externalId_eventHash;
        return (
          webhookEvents.find(
            (w) => w.source === source && w.externalId === externalId && w.eventHash === eventHash,
          ) ?? null
        );
      },
    },
    auditLog: {
      async create({ data }: { data: unknown }) {
        auditLogs.push(data);
        return data;
      },
    },
    // Batch form only — matches real Prisma-on-D1, which doesn't support interactive
    // transactions (see OrganizationRepository.createWithOwner's comment). Each array
    // element is already a running Promise by the time it reaches here (our fake's
    // create/update methods are plain async functions, not deferred query builders the
    // way Prisma's real client's are), so this is just Promise.all under the hood.
    async $transaction<T extends readonly unknown[]>(ops: readonly [...T]): Promise<T> {
      return Promise.all(ops) as Promise<T>;
    },
    async $disconnect() {},
    _debug: {
      users,
      organizations,
      memberships,
      credentials,
      mapServers,
      mapServerCapabilities,
      integrations,
      incidents,
      incidentEvents,
      incidentEvidence,
      rootCauseAnalyses,
      automationPolicies,
      resolutions,
      remediationActions,
      approvals,
      verifications,
      webhookEvents,
      auditLogs,
    },
  };

  return db;
}
