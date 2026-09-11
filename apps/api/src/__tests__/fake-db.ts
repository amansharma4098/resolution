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
      webhookEvents,
      auditLogs,
    },
  };

  return db;
}
