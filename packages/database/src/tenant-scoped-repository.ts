/**
 * Every tenant-owned model in schema.prisma carries `tenantId`. This base class is
 * the enforcement point described in ARCHITECTURE.md §8: `tenantId` is a
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
  protected readonly tenantId: string;

  constructor(tenantId: string) {
    if (!tenantId) {
      throw new Error("TenantScopedRepository requires a non-empty tenantId");
    }
    this.tenantId = tenantId;
  }

  /** Spread into every Prisma `where` clause: `where: { ...this.scope(), id } */
  protected scope(): { tenantId: string } {
    return { tenantId: this.tenantId };
  }
}
