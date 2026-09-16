import { Hono } from "hono";
import { z } from "zod";
import { MapServerType } from "@resolution/shared";
import type { MapServer, PrismaClient } from "@resolution/database";
import { CredentialRepository, MapServerRepository, auditLogWriter } from "@resolution/database";
import {
  getMapServerCatalog,
  getMapServerProvider,
  mcpClientFromContext,
  mcpToolFingerprint,
  McpRecoveryRuleSchema,
} from "@resolution/map-servers";
import type { SecretProvider } from "@resolution/credentials";
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

const SetCapabilityBody = z.object({
  enabled: z.boolean(),
  access: z.enum(["READ", "WRITE"]).optional(),
  fingerprint: z.string().optional(),
});

function toPublicMapServer(mapServer: MapServer) {
  const config = { ...mapServer.config };
  delete config.headers;
  return { ...mapServer, config };
}

export function buildMapServerRoutes(deps: {
  db: PrismaClient;
  env: Env;
  secretProvider: SecretProvider;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, secretProvider, organizationRepository } = deps;
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
      const credentials = new CredentialRepository(db, c.get("tenantId")!);
      const credential = await credentials.findUsableById(body.credentialId);
      if (!credential) {
        throw new ValidationError(
          "credentialId does not reference a credential in this organization",
        );
      }
    }

    const provider = getMapServerProvider(body.type);
    if (body.type === "MCP") {
      body.config = provider?.configSchema.parse({ url: body.config.url }) ?? body.config;
      if (
        Object.keys(CreateMapServerBody.parse(await c.req.json()).config).some(
          (key) => key !== "url",
        )
      ) {
        throw new ValidationError(
          "MCP configuration accepts only a URL. Store tokens in Credentials.",
        );
      }
    }
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
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

    // Closes the Phase 2 gap: "nothing real to toggle until a provider registers actual
    // capabilities". Every capability starts disabled — an org must explicitly turn one on
    // before the agent can ever call it (ARCHITECTURE.md §4).
    if (provider) {
      await mapServers.createCapabilitiesFromProvider(mapServer.id, provider.capabilities);
    }

    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
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
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
    const list = await mapServers.list();
    return c.json({ mapServers: list.map(toPublicMapServer) });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
    const mapServer = await mapServers.findById(c.req.param("id"));
    if (!mapServer) throw new NotFoundError("Map Server not found");
    const capabilities = await mapServers.listCapabilities(mapServer.id);
    const catalog = (mapServer.config.toolCatalog ?? {}) as Record<string, object>;
    return c.json({
      mapServer: toPublicMapServer(mapServer),
      capabilities: capabilities.map((cap) => ({ ...cap, ...catalog[cap.key] })),
    });
  });

  router.patch("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const body = z.object({ disabled: z.boolean() }).parse(await c.req.json());
    const repo = new MapServerRepository(db, c.get("tenantId")!);
    const server = await repo.findById(c.req.param("id"));
    if (!server) throw new NotFoundError("Connection not found");
    const updated = await repo.updateConfig(server.id, {
      ...server.config,
      disabled: body.disabled,
    });
    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: body.disabled ? "connection.disabled" : "connection.enabled",
      targetType: "MapServer",
      targetId: server.id,
      requestId: c.get("requestId"),
    });
    return c.json({ mapServer: toPublicMapServer(updated!) });
  });

  router.delete("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
    const deleted = await mapServers.delete(c.req.param("id"));
    if (!deleted) throw new NotFoundError("Map Server not found");

    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.deleted",
      targetType: "MapServer",
      targetId: c.req.param("id"),
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
  });

  router.put("/:id/capabilities/:key/recovery", auth, tenantContext, requireAdmin, async (c) => {
    const repo = new MapServerRepository(db, c.get("tenantId")!);
    const server = await repo.findById(c.req.param("id"));
    if (!server || server.type !== "MCP") throw new NotFoundError("MCP server not found");
    const rule = McpRecoveryRuleSchema.parse(await c.req.json());
    const capabilities = await repo.listCapabilities(server.id);
    const action = capabilities.find(
      (cap) => cap.key === c.req.param("key") && cap.enabled && cap.mutating,
    );
    const verifier = capabilities.find(
      (cap) => cap.key === rule.tool && cap.enabled && !cap.mutating,
    );
    const reviews = server.config.toolReviews as Record<
      string,
      { access: string; fingerprint: string }
    >;
    if (
      !action ||
      !verifier ||
      reviews?.[action.key]?.access !== "WRITE" ||
      reviews?.[rule.tool]?.access !== "READ" ||
      rule.actionFingerprint !== reviews[action.key]?.fingerprint ||
      rule.verifierFingerprint !== reviews[rule.tool]?.fingerprint
    ) {
      throw new ValidationError(
        "Enable and review the repair tool and its read-only recovery tool before saving a recovery check",
      );
    }
    await repo.updateConfig(server.id, {
      ...server.config,
      recoveryRules: { ...((server.config.recoveryRules as object) ?? {}), [action.key]: rule },
    });
    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.recovery_configured",
      targetType: "MapServer",
      targetId: server.id,
      metadata: { action: action.key, verifier: rule.tool, resultPath: rule.resultPath },
    });
    return c.json({ recovery: rule });
  });

  router.patch("/:id/capabilities/:key", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
    const mapServer = await mapServers.findById(c.req.param("id"));
    if (!mapServer) throw new NotFoundError("Map Server not found");

    const body = SetCapabilityBody.parse(await c.req.json());
    if (mapServer.type === "MCP" && body.enabled) {
      if (!body.access)
        throw new ValidationError("Review this tool as READ or WRITE before enabling it");
      if (mapServer.config.disabled)
        throw new ValidationError("Enable the connection before reviewing tools");
      const credential =
        mapServer.credentialId &&
        (await new CredentialRepository(db, c.get("tenantId")!).findUsableById(
          mapServer.credentialId,
        ));
      if (!credential) throw new ValidationError("Attach a credential before reviewing tools");
      const ctx = {
        tenantId: c.get("tenantId")!,
        mapServerId: mapServer.id,
        environment: mapServer.environments[0] ?? "default",
        config: mapServer.config,
        credential: await secretProvider.decrypt(credential.encryptedData, {
          tenantId: c.get("tenantId")!,
        }),
        requestId: c.get("requestId"),
      };
      const tool = (await mcpClientFromContext(ctx).listTools()).find(
        (t) => t.name === c.req.param("key"),
      );
      if (!tool) throw new NotFoundError("Tool is no longer available");
      if (!body.fingerprint || body.fingerprint !== (await mcpToolFingerprint(tool))) {
        throw new ValidationError(
          "Tool definition changed or has not been reviewed. Discover tools and review again.",
        );
      }
      await mapServers.updateConfig(mapServer.id, {
        ...mapServer.config,
        toolReviews: {
          ...((mapServer.config.toolReviews as object) ?? {}),
          [tool.name]: { access: body.access, fingerprint: await mcpToolFingerprint(tool) },
        },
      });
      await db.mapServerCapability.update({
        where: { mapServerId_key: { mapServerId: mapServer.id, key: tool.name } },
        data: {
          mutating: body.access === "WRITE",
          riskLevel: body.access === "READ" ? "LOW" : "HIGH",
        },
      });
    }
    const updated = await mapServers.setCapabilityEnabled(
      mapServer.id,
      c.req.param("key"),
      body.enabled,
    );
    if (!updated) throw new NotFoundError("Capability not found");

    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.capability_toggled",
      targetType: "MapServer",
      targetId: mapServer.id,
      requestId: c.get("requestId"),
      metadata: { key: c.req.param("key"), enabled: body.enabled, access: body.access },
    });

    return c.json({ capability: updated });
  });

  router.post("/:id/test", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
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
      const credentials = new CredentialRepository(db, c.get("tenantId")!);
      const credential = await credentials.findUsableById(mapServer.credentialId);
      if (!credential) {
        result = { status: "DISCONNECTED", detail: "Attached credential no longer exists" };
      } else {
        const decrypted = await secretProvider.decrypt(credential.encryptedData, {
          tenantId: c.get("tenantId")!,
        });
        const testResult = await provider.healthCheck({
          tenantId: c.get("tenantId")!,
          mapServerId: mapServer.id,
          environment: mapServer.environments[0] ?? "default",
          credential: decrypted,
          config: mapServer.config,
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
      tenantId: c.get("tenantId"),
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

  // For a provider whose capability set isn't fixed in code (the generic `MCP` provider —
  // see packages/map-servers/src/mcp) — (re-)discovers it from the org's actual configured
  // server and persists it via the same additive, non-destructive sync
  // `MapServerRepository.syncCapabilitiesFromProvider` documents. A no-op 400 for every
  // other provider, whose capabilities are fixed at registration and never need refreshing.
  router.post("/:id/refresh-capabilities", auth, tenantContext, requireAdmin, async (c) => {
    const mapServers = new MapServerRepository(db, c.get("tenantId")!);
    const mapServer = await mapServers.findById(c.req.param("id"));
    if (!mapServer) throw new NotFoundError("Map Server not found");

    const provider = getMapServerProvider(mapServer.type);
    if (!provider)
      throw new ValidationError(
        `No provider is registered for ${mapServer.type} yet in this deployment`,
      );
    if (!provider.discoverCapabilities) {
      throw new ValidationError(
        `${provider.metadata.displayName} has a fixed capability set — nothing to refresh`,
      );
    }
    if (!mapServer.credentialId) {
      throw new ValidationError("Attach a credential before discovering capabilities");
    }

    const credentials = new CredentialRepository(db, c.get("tenantId")!);
    const credential = await credentials.findUsableById(mapServer.credentialId);
    if (!credential) throw new ValidationError("Attached credential no longer exists");

    const decrypted = await secretProvider.decrypt(credential.encryptedData, {
      tenantId: c.get("tenantId")!,
    });
    const discovered = await provider.discoverCapabilities({
      tenantId: c.get("tenantId")!,
      mapServerId: mapServer.id,
      environment: mapServer.environments[0] ?? "default",
      credential: decrypted,
      config: mapServer.config,
      requestId: c.get("requestId"),
    });
    await mapServers.syncCapabilitiesFromProvider(mapServer.id, discovered);
    const catalog = Object.fromEntries(
      discovered.filter((cap) => cap.definition).map((cap) => [cap.key, cap.definition]),
    );
    await mapServers.updateConfig(mapServer.id, { ...mapServer.config, toolCatalog: catalog });

    await writeAuditLog(auditLogWriter(db), {
      tenantId: c.get("tenantId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "map_server.capabilities_refreshed",
      targetType: "MapServer",
      targetId: mapServer.id,
      requestId: c.get("requestId"),
      metadata: { discoveredCount: discovered.length },
    });

    const capabilities = await mapServers.listCapabilities(mapServer.id);
    return c.json({ capabilities: capabilities.map((cap) => ({ ...cap, ...catalog[cap.key] })) });
  });

  return router;
}
