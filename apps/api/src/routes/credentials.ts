import { Hono } from "hono";
import { z } from "zod";
import type { Credential, PrismaClient } from "@resolution/database";
import { CredentialRepository, auditLogWriter } from "@resolution/database";
import {
  CredentialPayloadSchemas,
  maskedHintFor,
  validateCredentialPayload,
  type SecretProvider,
} from "@resolution/credentials";
import { writeAuditLog } from "@resolution/security";
import type { OrganizationRepository } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError } from "../lib/errors";
import type { AppEnv } from "../types";

const AUTHENTICATION_TYPES = Object.keys(CredentialPayloadSchemas) as [
  keyof typeof CredentialPayloadSchemas,
  ...(keyof typeof CredentialPayloadSchemas)[],
];

const CreateCredentialBody = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  authenticationType: z.enum(AUTHENTICATION_TYPES),
  payload: z.record(z.unknown()),
});

const RotateCredentialBody = z.object({
  payload: z.record(z.unknown()),
});

/** Shape returned to the client — never `encryptedData`, only a masked hint. */
function toPublicCredential(credential: Credential, maskedHint: string) {
  return {
    id: credential.id,
    name: credential.name,
    provider: credential.provider,
    authenticationType: credential.authenticationType,
    status: credential.status,
    lastValidatedAt: credential.lastValidatedAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    maskedHint,
  };
}

export function buildCredentialRoutes(deps: {
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

  // A masked hint is derived from the plaintext payload at write time (create/rotate) and
  // stored nowhere — it's recomputed from the freshly-decrypted payload only when needed.
  // For list/get we can't cheaply recompute it without decrypting every row, so those
  // return a generic mask; the create/rotate response (the one moment the plaintext is in
  // hand) returns the real last-4-chars hint.
  const genericMaskedHint = "••••••••";

  router.post("/", auth, tenantContext, requireAdmin, async (c) => {
    const body = CreateCredentialBody.parse(await c.req.json());
    const payload = validateCredentialPayload(body.authenticationType, body.payload);

    const encryptedData = await secretProvider.encrypt(payload, {
      organizationId: c.get("organizationId")!,
    });

    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const credential = await credentials.create({
      name: body.name,
      provider: body.provider,
      authenticationType: body.authenticationType,
      encryptedData,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "credential.created",
      targetType: "Credential",
      targetId: credential.id,
      requestId: c.get("requestId"),
      metadata: { name: credential.name, provider: credential.provider },
    });

    return c.json(
      { credential: toPublicCredential(credential, maskedHintFor(body.authenticationType, payload)) },
      201,
    );
  });

  router.get("/", auth, tenantContext, async (c) => {
    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const list = await credentials.list();
    return c.json({ credentials: list.map((cred) => toPublicCredential(cred, genericMaskedHint)) });
  });

  router.get("/:id", auth, tenantContext, async (c) => {
    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const credential = await credentials.findById(c.req.param("id"));
    if (!credential) throw new NotFoundError("Credential not found");
    return c.json({ credential: toPublicCredential(credential, genericMaskedHint) });
  });

  router.delete("/:id", auth, tenantContext, requireAdmin, async (c) => {
    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const deleted = await credentials.delete(c.req.param("id"));
    if (!deleted) throw new NotFoundError("Credential not found");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "credential.deleted",
      targetType: "Credential",
      targetId: c.req.param("id"),
      requestId: c.get("requestId"),
    });

    return c.body(null, 204);
  });

  // Full live connectivity testing happens through a Map Server's own authAdapter once one
  // references this credential (see packages/map-servers) — a credential is provider-
  // agnostic and may be reused by several Map Servers, so it has no single "connection" of
  // its own to test yet. What we CAN verify here, honestly, is that the stored payload
  // still decrypts and still matches its own shape — that's what this does and all it
  // claims to do.
  router.post("/:id/test", auth, tenantContext, requireAdmin, async (c) => {
    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const credential = await credentials.findById(c.req.param("id"));
    if (!credential) throw new NotFoundError("Credential not found");

    let valid = true;
    let detail = "Credential payload decrypts and matches its expected shape";
    try {
      const decrypted = await secretProvider.decrypt(credential.encryptedData, {
        organizationId: c.get("organizationId")!,
      });
      validateCredentialPayload(
        credential.authenticationType as keyof typeof CredentialPayloadSchemas,
        decrypted,
      );
    } catch (err) {
      valid = false;
      detail = err instanceof Error ? err.message : "Credential failed validation";
    }

    const updated = await credentials.updateStatus(credential.id, valid ? "VALID" : "INVALID");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "credential.tested",
      targetType: "Credential",
      targetId: credential.id,
      requestId: c.get("requestId"),
      metadata: { valid },
    });

    return c.json({ credential: toPublicCredential(updated!, genericMaskedHint), detail });
  });

  router.post("/:id/rotate", auth, tenantContext, requireAdmin, async (c) => {
    const credentials = new CredentialRepository(db, c.get("organizationId")!);
    const existing = await credentials.findById(c.req.param("id"));
    if (!existing) throw new NotFoundError("Credential not found");

    const body = RotateCredentialBody.parse(await c.req.json());
    const payload = validateCredentialPayload(
      existing.authenticationType as keyof typeof CredentialPayloadSchemas,
      body.payload,
    );
    const encryptedData = await secretProvider.encrypt(payload, {
      organizationId: c.get("organizationId")!,
    });

    const updated = await credentials.updateEncryptedData(existing.id, encryptedData);
    if (!updated) throw new NotFoundError("Credential not found");

    await writeAuditLog(auditLogWriter(db), {
      organizationId: c.get("organizationId"),
      actorType: "user",
      actorId: c.get("userId"),
      action: "credential.rotated",
      targetType: "Credential",
      targetId: updated.id,
      requestId: c.get("requestId"),
    });

    return c.json({
      credential: toPublicCredential(
        updated,
        maskedHintFor(existing.authenticationType as keyof typeof CredentialPayloadSchemas, payload),
      ),
    });
  });

  return router;
}
