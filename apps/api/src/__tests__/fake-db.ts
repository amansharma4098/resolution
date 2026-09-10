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
      where: { userId: string };
    }): Promise<(FakeMembership & { organization: FakeOrganization })[]>;
    findUnique(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }): Promise<FakeMembership | null>;
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
  integration: {
    create(args: { data: Partial<FakeIntegration> }): Promise<FakeIntegration>;
    findMany(args: { where: { organizationId: string } }): Promise<FakeIntegration[]>;
    findFirst(args: { where: OrgScopedWhere }): Promise<FakeIntegration | null>;
    update(args: { where: { id: string }; data: Partial<FakeIntegration> }): Promise<FakeIntegration>;
    delete(args: { where: { id: string } }): Promise<FakeIntegration>;
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
    integrations: FakeIntegration[];
    auditLogs: unknown[];
  };
}

export function createFakeDb(): FakeDb {
  const users: FakeUser[] = [];
  const organizations: FakeOrganization[] = [];
  const memberships: FakeMembership[] = [];
  const credentials: FakeCredential[] = [];
  const mapServers: FakeMapServer[] = [];
  const integrations: FakeIntegration[] = [];
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
      async findMany({ where }: { where: { userId: string } }) {
        return memberships
          .filter((m) => m.userId === where.userId)
          .map((m) => ({
            ...m,
            organization: organizations.find((o) => o.id === m.organizationId)!,
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
    _debug: { users, organizations, memberships, credentials, mapServers, integrations, auditLogs },
  };

  return db;
}
