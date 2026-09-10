/**
 * Every tenant-owned model in schema.prisma carries `organizationId`. This base class is
 * the enforcement point described in ARCHITECTURE.md §8: `organizationId` is a
 * constructor argument derived by the API layer from the authenticated session
 * (see apps/api/src/middleware/tenant-context.ts, added in Phase 1) — it is never
 * accepted as a field on an incoming request body, and no subclass may build a Prisma
 * `where` clause without spreading `this.scope()` into it.
 *
 * This does not replace Postgres row-level security in production — it is the
 * application-layer half of defense in depth. Row-level security policies are added per
 * table in a later migration (tracked in IMPLEMENTATION_PLAN.md Phase 12).
 */
export abstract class TenantScopedRepository {
  protected readonly organizationId: string;

  constructor(organizationId: string) {
    if (!organizationId) {
      throw new Error("TenantScopedRepository requires a non-empty organizationId");
    }
    this.organizationId = organizationId;
  }

  /** Spread into every Prisma `where` clause: `where: { ...this.scope(), id } */
  protected scope(): { organizationId: string } {
    return { organizationId: this.organizationId };
  }
}
