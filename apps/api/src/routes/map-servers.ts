import { Hono } from "hono";
import { z } from "zod";
import { MapServerType } from "@resolution/shared";
import type { MapServer, PrismaClient } from "@resolution/database";
import { CredentialRepository, MapServerRepository, auditLogWriter } from "@resolution/database";
import { getMapServerCatalog, getMapServerProvider } from "@resolution/map-servers";
import { writeAuditLog } from "@resolution/security";
import type { OrganizationRepository } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateMapServerBody = z.object({
  type: MapServerType,
  name: z.string().min(1).max(200),
  credentialId: z.string().uuid().optional(),
  environments: z.array(z.string().min(1)).default([]),
  config: z.record(z.unknown()).default({}),
});

function toPublicMapServer(mapServer: MapServer) {
  return mapServer;
}

export function buildMapServerRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");

  // Powers the "select type" step of the config wizard — every MapServerType the platform
  // knows about, each flagged with whether a provider is actually registered yet
  // (packages/map-servers/src/registry.ts). Registered ahead of "/:id" so a literal
  // "catalog" segment can never be swallowed by the param route.
  router.get("/catalog", auth, tenantContext, (c) => {
    return c.json({ catalog: getMapServerCatalog() });
  });

  router.post("/", auth, tenantContext, requireAdmin, async (c) => {
    const body = CreateMapServerBody.parse(await c.req.json());

    if (body.credentialId) {
      const credentials = new CredentialRepository(db, c.get("organizationId")!);
      const credential = await credentials.findById(body.credentialId);
      if (!credential) {
        throw new ValidationError("credentialId does not reference a credential in this organization");
      }
    }

    const provider = getMapServerProvider(body.type);
    const mapServers = new MapServerRepository(db, c.get("organizationId")!);
    const mapServer = await mapServers.create({
      type: body.type,
      name: body.name,
      credentialId: body.credentialId,
      environments: body.environments,
      config: body.config,
      // isMock reflects the registered provider's own declaration — never guessed, and
      // never true for a provider that hasn't shipped yet (those are simply UNCONFIGURED
      // until Phase 5/10 register them, not silently treated as mock).
      isMock: provider?.metadata.isMock ?? false,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.created",
      targetType: "MapServer",
      targetId: mapServer.id,
      requestId: c.get("requestId"),
      metadata: { type: mapServer.type, name: mapServer.name },
    });

    return c.json({ mapServer: toPublicMapServer(mapServer) }, 201);
  });

  router.get("/", auth, tenantContext, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("organizationId")!);
    const list = await mapServers.list();
    return c.json({ mapServers: list.map(toPublicMapServer) });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("organizationId")!);
    const mapServer = await mapServers.findById(c.req.param("id"));
    if (!mapServer) throw new NotFoundError("Map Server not found");
    return c.json({ mapServer: toPublicMapServer(mapServer) });
  });

  router.delete("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("organizationId")!);
    const deleted = await mapServers.delete(c.req.param("id"));
    if (!deleted) throw new NotFoundError("Map Server not found");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.deleted",
      targetType: "MapServer",
      targetId: c.req.param("id"),
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
  });

  router.post("/:id/test", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("organizationId")!);
    const mapServer = await mapServers.findById(c.req.param("id"));
    if (!mapServer) throw new NotFoundError("Map Server not found");

    const provider = getMapServerProvider(mapServer.type);
    let result: { status: "CONNECTED" | "DEGRADED" | "DISCONNECTED"; detail: string };

    if (!provider) {
      // Honest, not fake: this provider genuinely isn't implemented yet (tracked in
      // IMPLEMENTATION_PLAN.md) — never report CONNECTED for something that can't
      // actually be reached.
      result = {
        status: "DISCONNECTED",
        detail: `No provider is registered for ${mapServer.type} yet in this deployment`,
      };
    } else if (!mapServer.credentialId) {
      result = { status: "DISCONNECTED", detail: "No credential attached to this Map Server" };
    } else {
      const credentials = new CredentialRepository(db, c.get("organizationId")!);
      const credential = await credentials.findById(mapServer.credentialId);
      if (!credential) {
        result = { status: "DISCONNECTED", detail: "Attached credential no longer exists" };
      } else {
        const testResult = await provider.healthCheck({
          organizationId: c.get("organizationId")!,
          mapServerId: mapServer.id,
          environment: mapServer.environments[0] ?? "default",
          credential: {}, // decrypted credential wiring lands with the first real provider in Phase 5
          requestId: c.get("requestId"),
        });
        result = {
          status: testResult.status as "CONNECTED" | "DEGRADED" | "DISCONNECTED",
          detail: testResult.detail ?? "",
        };
      }
    }

    const updated = await mapServers.updateStatus(mapServer.id, result.status);

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.tested",
      targetType: "MapServer",
      targetId: mapServer.id,
      requestId: c.get("requestId"),
      metadata: { status: result.status },
    });

    return c.json({ mapServer: toPublicMapServer(updated!), detail: result.detail });
  });

  return router;
}
