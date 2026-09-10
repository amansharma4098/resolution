import type { FastifyInstance } from "fastify";
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
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { NotFoundError } from "../lib/errors";
import type { OrganizationRepository } from "@resolution/database";

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

export function registerCredentialRoutes(
  app: FastifyInstance,
  deps: {
    db: PrismaClient;
    env: Env;
    secretProvider: SecretProvider;
    organizationRepository: OrganizationRepository;
  },
): void {
  const { db, env, secretProvider, organizationRepository } = deps;
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireAdmin = requireMinimumRole("ADMIN");
  const preHandler = [auth, tenantContext];

  // A masked hint is derived from the plaintext payload at write time (create/rotate) and
  // stored nowhere — it's recomputed from the freshly-decrypted payload only when needed.
  // For list/get we can't cheaply recompute it without decrypting every row, so those
  // return a generic mask; the create/rotate response (the one moment the plaintext is in
  // hand) returns the real last-4-chars hint.
  async function genericMaskedHint(_credential: Credential): Promise<string> {
    return "••••••••";
  }

  app.post("/", { preHandler: [...preHandler, requireAdmin] }, async (request, reply) => {
    const body = CreateCredentialBody.parse(request.body);
    const payload = validateCredentialPayload(body.authenticationType, body.payload);

    const encryptedData = await secretProvider.encrypt(payload, {
      organizationId: request.organizationId!,
    });

    const credentials = new CredentialRepository(db, request.organizationId!);
    const credential = await credentials.create({
      name: body.name,
      provider: body.provider,
      authenticationType: body.authenticationType,
      encryptedData,
    });

    await writeAuditLog(auditLogWriter(db), {
      organizationId: request.organizationId,
      actorType: "user",
      actorId: request.userId,
      action: "credential.created",
      targetType: "Credential",
      targetId: credential.id,
      requestId: request.id,
      metadata: { name: credential.name, provider: credential.provider },
    });

    reply
      .status(201)
      .send({ credential: toPublicCredential(credential, maskedHintFor(body.authenticationType, payload)) });
  });

  app.get("/", { preHandler }, async (request, reply) => {
    const credentials = new CredentialRepository(db, request.organizationId!);
    const list = await credentials.list();
    const withHints = await Promise.all(
      list.map(async (c) => toPublicCredential(c, await genericMaskedHint(c))),
    );
    reply.send({ credentials: withHints });
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler }, async (request, reply) => {
    const credentials = new CredentialRepository(db, request.organizationId!);
    const credential = await credentials.findById(request.params.id);
    if (!credential) throw new NotFoundError("Credential not found");
    reply.send({ credential: toPublicCredential(credential, await genericMaskedHint(credential)) });
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const credentials = new CredentialRepository(db, request.organizationId!);
      const deleted = await credentials.delete(request.params.id);
      if (!deleted) throw new NotFoundError("Credential not found");

      await writeAuditLog(auditLogWriter(db), {
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "credential.deleted",
        targetType: "Credential",
        targetId: request.params.id,
        requestId: request.id,
      });

      reply.status(204).send();
    },
  );

  // Full live connectivity testing happens through a Map Server's own authAdapter once one
  // references this credential (see packages/map-servers) — a credential is provider-
  // agnostic and may be reused by several Map Servers, so it has no single "connection" of
  // its own to test yet. What we CAN verify here, honestly, is that the stored payload
  // still decrypts and still matches its own shape — that's what this does and all it
  // claims to do.
  app.post<{ Params: { id: string } }>(
    "/:id/test",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const credentials = new CredentialRepository(db, request.organizationId!);
      const credential = await credentials.findById(request.params.id);
      if (!credential) throw new NotFoundError("Credential not found");

      let valid = true;
      let detail = "Credential payload decrypts and matches its expected shape";
      try {
        const decrypted = await secretProvider.decrypt(credential.encryptedData, {
          organizationId: request.organizationId!,
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
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "credential.tested",
        targetType: "Credential",
        targetId: credential.id,
        requestId: request.id,
        metadata: { valid },
      });

      reply.send({
        credential: toPublicCredential(updated!, await genericMaskedHint(updated!)),
        detail,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/rotate",
    { preHandler: [...preHandler, requireAdmin] },
    async (request, reply) => {
      const credentials = new CredentialRepository(db, request.organizationId!);
      const existing = await credentials.findById(request.params.id);
      if (!existing) throw new NotFoundError("Credential not found");

      const body = RotateCredentialBody.parse(request.body);
      const payload = validateCredentialPayload(
        existing.authenticationType as keyof typeof CredentialPayloadSchemas,
        body.payload,
      );
      const encryptedData = await secretProvider.encrypt(payload, {
        organizationId: request.organizationId!,
      });

      const updated = await credentials.updateEncryptedData(existing.id, encryptedData);
      if (!updated) throw new NotFoundError("Credential not found");

      await writeAuditLog(auditLogWriter(db), {
        organizationId: request.organizationId,
        actorType: "user",
        actorId: request.userId,
        action: "credential.rotated",
        targetType: "Credential",
        targetId: updated.id,
        requestId: request.id,
      });

      reply.send({
        credential: toPublicCredential(
          updated,
          maskedHintFor(existing.authenticationType as keyof typeof CredentialPayloadSchemas, payload),
        ),
      });
    },
  );
}
