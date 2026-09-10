import { randomUUID } from "node:crypto";

/**
 * A minimal in-memory stand-in for PrismaClient, covering only the calls
 * UserRepository/OrganizationRepository/auditLogWriter actually make. Lets apps/api's
 * route tests run without a live Postgres — full repository behavior (real SQL,
 * constraints, cascades) is covered separately once integration tests run against the
 * docker-compose Postgres in CI (see IMPLEMENTATION_PLAN.md).
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
  auditLog: {
    create(args: { data: unknown }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
  _debug: {
    users: FakeUser[];
    organizations: FakeOrganization[];
    memberships: FakeMembership[];
    auditLogs: unknown[];
  };
}

export function createFakeDb(): FakeDb {
  const users: FakeUser[] = [];
  const organizations: FakeOrganization[] = [];
  const memberships: FakeMembership[] = [];
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
          id: randomUUID(),
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
    auditLog: {
      async create({ data }: { data: unknown }) {
        auditLogs.push(data);
        return data;
      },
    },
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async $disconnect() {},
    _debug: { users, organizations, memberships, auditLogs },
  };

  return db;
}
