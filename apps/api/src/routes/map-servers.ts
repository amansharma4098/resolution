import type { FastifyInstance } from "fastify";
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

export function registerMapServerRoutes(
  app: FastifyInstance,
  deps: { db: PrismaClient; env: Env; organizationRepository: OrganizationRepository },
): void {
  const { db, env, organizationRepository } = deps;
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");
  const preHandler = [auth, tenantContext];

  // Powers the "select type" step of the config wizard — every MapServerType the platform
  // knows about, each flagged with whether a provider is actually registered yet
  // (packages/map-servers/src/registry.ts). Static route, registered ahead of "/:id" so it
  // can never be shadowed by the param route.
  app.get("/catalog", { preHandler }, async (_request, reply) => {
    reply.send({ catalog: getMapServerCatalog() });
  });

  app.post("/", { preHandler: [...preHandler, requireAdmin] }, async (request, reply) => {
    const body = CreateMapServerBody.parse(request.body);

    if (body.credentialId) {
      const credentials = new CredentialRepository(db, request.organizationId!);
      const credential = await credentials.findById(body.credentialId);
      if (!credential) {
        throw new ValidationError("credentialId does not reference a credential in this organization");
      }
    }

    const provider = getMapServerProvider(body.type);
    const mapServers = new MapServerRepository(db, request.organizationId!);
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
      organizationId: request.organizationId,
      actorType: "user",
      actorId: request.userId,
      action: "map_server.created",
      targetType: "MapServer",
      targetId: mapServer.id,
      requestId: request.id,
      metadata: { type: mapServer.type, name: mapServer.name },
    });

    reply.status(201).send({ mapServer: toPublicMapServer(mapServer) });
  });

  app.get("/", { preHandler }, async (request, reply) => {
    const mapServers = new MapServerRepository(db, request.organizationId!);
    const list = await mapServers.list();
    reply.send({ mapServers: list.map(toPublicMapServer) });
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler }, async (request, reply) => {
    const mapServers = new MapServerRepository(db, request.organizationId!);
    const mapServer = await mapServers.findById(request.params.id);
    if (!mapServer) throw new NotFoundError("Map Server not found");
    reply.send({ mapServer: toPublicMapServer(mapServer) });
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const mapServers = new MapServerRepository(db, request.organizationId!);
      const deleted = await mapServers.delete(request.params.id);
      if (!deleted) throw new NotFoundError("Map Server not found");

      await writeAuditLog(auditLogWriter(db), {
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "map_server.deleted",
        targetType: "MapServer",
        targetId: request.params.id,
        requestId: request.id,
      });

      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/test",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const mapServers = new MapServerRepository(db, request.organizationId!);
      const mapServer = await mapServers.findById(request.params.id);
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
        const credentials = new CredentialRepository(db, request.organizationId!);
        const credential = await credentials.findById(mapServer.credentialId);
        if (!credential) {
          result = { status: "DISCONNECTED", detail: "Attached credential no longer exists" };
        } else {
          const environments = Array.isArray(mapServer.environments)
            ? (mapServer.environments as string[])
            : [];
          const testResult = await provider.healthCheck({
            organizationId: request.organizationId!,
            mapServerId: mapServer.id,
            environment: environments[0] ?? "default",
            credential: {}, // decrypted credential wiring lands with the first real provider in Phase 5
            requestId: request.id,
          });
          result = { status: testResult.status as "CONNECTED" | "DEGRADED" | "DISCONNECTED", detail: testResult.detail ?? "" };
        }
      }

      const updated = await mapServers.updateStatus(mapServer.id, result.status);

      await writeAuditLog(auditLogWriter(db), {
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "map_server.tested",
        targetType: "MapServer",
        targetId: mapServer.id,
        requestId: request.id,
        metadata: { status: result.status },
      });

      reply.send({ mapServer: toPublicMapServer(updated!), detail: result.detail });
    },
  );
}
