import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { processIngestionMessage } from "../queue/consumer";
import { syncSource } from "../lib/source-sync";
import { closeIncidentSource } from "../lib/source-closure";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const issue = (key = "OPS-1") => ({
  id: "10001",
  key,
  fields: {
    summary: "API unavailable",
    description: "Errors after deployment",
    status: { name: "Open", statusCategory: { key: "new" } },
    project: { key: "OPS", name: "Operations" },
    created: "2026-09-16T00:00:00Z",
    updated: "2026-09-16T00:00:00Z",
  },
});
const payload = () => JSON.stringify({ webhookEvent: "jira:issue_created", issue: issue() });

describe("incident workflow with real SQLite and vendor HTTP contracts", () => {
  let db: PrismaClient;
  let directory: string;
  const secrets = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "fixcaptain-workflow-"));
    const file = join(directory, "test.db");
    execFileSync("python3", [
      "-c",
      "import sqlite3,pathlib,sys; db=sqlite3.connect(sys.argv[1]); [db.executescript(p.read_text()) for p in sorted(pathlib.Path(sys.argv[2]).glob('*/migration.sql'))]; db.close()",
      file,
      resolve("../../packages/database/prisma/migrations"),
    ]);
    db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db?.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
  async function source(tenantId?: string) {
    const tenant =
      tenantId ??
      (await db.organization.create({ data: { name: "Customer", slug: crypto.randomUUID() } })).id;
    return db.integration.create({
      data: {
        tenantId: tenant,
        type: "JIRA",
        name: "Jira",
        config: JSON.stringify({
          baseUrl: "https://customer.atlassian.net",
          environment: "production",
        }),
      },
    });
  }
  async function connect(id: string, autoClose = false) {
    const integration = await db.integration.findUniqueOrThrow({ where: { id } });
    const credential = await db.credential.create({
      data: {
        tenantId: integration.tenantId,
        name: "Jira token",
        provider: "jira",
        authenticationType: "BASIC_AUTH",
        encryptedData: await secrets.encrypt(
          { username: "bot@example.com", password: "test-secret" },
          { tenantId: integration.tenantId },
        ),
      },
    });
    await db.integration.update({
      where: { id },
      data: {
        syncEnabled: true,
        credentialId: credential.id,
        config: JSON.stringify({
          baseUrl: "https://customer.atlassian.net",
          autoClose,
          resolutionTransitionId: "31",
        }),
      },
    });
    return credential;
  }

  it("isolates identical webhook deliveries across tenants and source instances", async () => {
    const a = await source();
    const b = await source();
    const c = await source(a.tenantId);
    for (const integration of [a, b, c])
      await processIngestionMessage(db, {
        source: "JIRA",
        integrationId: integration.id,
        rawBody: payload(),
      });
    expect(await db.incident.count()).toBe(3);
    expect(await db.webhookEvent.count()).toBe(3);
    await processIngestionMessage(db, { source: "JIRA", integrationId: a.id, rawBody: payload() });
    expect(await db.incident.count()).toBe(3);
    expect((await db.incident.findFirstOrThrow()).environment).toBe("production");
  });

  it("recovers a failed downstream send without losing or duplicating the incident", async () => {
    const integration = await source();
    const message = { source: "JIRA" as const, integrationId: integration.id, rawBody: payload() };
    await expect(
      processIngestionMessage(db, message, {
        onIncidentCreated: async () => {
          throw new Error("Queue unavailable");
        },
      }),
    ).rejects.toThrow("Queue unavailable");
    expect(await db.incident.count()).toBe(1);
    expect(await db.webhookEvent.count()).toBe(0);
    const send = vi.fn(async () => {});
    await processIngestionMessage(db, message, { onIncidentCreated: send });
    expect(send).toHaveBeenCalledOnce();
    expect(await db.webhookEvent.count()).toBe(1);
    expect((await db.incident.findFirstOrThrow()).investigationDispatchedAt).not.toBeNull();
  });

  it("deduplicates concurrent deliveries through the database constraint", async () => {
    const integration = await source();
    const message = { source: "JIRA" as const, integrationId: integration.id, rawBody: payload() };
    await Promise.all([processIngestionMessage(db, message), processIngestionMessage(db, message)]);
    expect(await db.incident.count()).toBe(1);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("updates source details without resetting investigation state", async () => {
    const integration = await source();
    const first = await processIngestionMessage(db, {
      source: "JIRA",
      integrationId: integration.id,
      rawBody: payload(),
    });
    await db.incident.update({
      where: { id: first.incidentId },
      data: { status: "INVESTIGATING" },
    });
    const changed = issue();
    changed.fields.summary = "API errors affect checkout";
    const send = vi.fn(async () => {});
    await processIngestionMessage(
      db,
      {
        source: "JIRA",
        integrationId: integration.id,
        rawBody: JSON.stringify({ webhookEvent: "jira:issue_updated", issue: changed }),
      },
      { onIncidentCreated: send },
    );
    const stored = await db.incident.findFirstOrThrow();
    expect(stored.title).toBe(changed.fields.summary);
    expect(stored.status).toBe("INVESTIGATING");
    expect(send).not.toHaveBeenCalled();
  });

  it("collects paginated Jira issues and pauses without reading credentials", async () => {
    const integration = await source();
    await connect(integration.id);
    const fetchMock = vi.fn(async () => json({ issues: [issue()], nextPageToken: "page-two" }));
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.fn(async () => {});
    await syncSource(db, secrets, { send }, integration.id);
    expect(send).toHaveBeenCalledOnce();
    expect(
      (await db.integration.findUniqueOrThrow({ where: { id: integration.id } })).syncCursor,
    ).toBe("page-two");
    await syncSource(db, secrets, { send }, integration.id);
    const second = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(second[1].body as string).nextPageToken).toBe("page-two");
    expect(second[1].redirect).toBe("error");
    await db.integration.update({ where: { id: integration.id }, data: { syncEnabled: false } });
    await syncSource(db, secrets, { send }, integration.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never decrypts a credential belonging to a different tenant", async () => {
    const a = await source();
    const b = await source();
    const credential = await connect(a.id);
    await db.integration.update({
      where: { id: b.id },
      data: { credentialId: credential.id, syncEnabled: true },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncSource(db, secrets, { send: async () => {} }, b.id)).rejects.toThrow(
      "missing, expired or revoked",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires persisted recovery proof, retries source closure, and never repeats confirmed closure", async () => {
    const integration = await source();
    await connect(integration.id, true);
    const result = await processIngestionMessage(db, {
      source: "JIRA",
      integrationId: integration.id,
      rawBody: payload(),
    });
    const id = result.incidentId!;
    await db.incident.update({
      where: { id },
      data: { status: "RESOLVED", sourceSyncStatus: "PENDING" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await closeIncidentSource(db, secrets, integration.tenantId, id);
    expect(fetchMock).not.toHaveBeenCalled();
    const rca = await db.rootCauseAnalysis.create({
      data: { incidentId: id, summary: "Verified fix", claims: "[]", confidence: 1 },
    });
    const resolution = await db.resolution.create({
      data: { incidentId: id, rcaId: rca.id, proposedAction: "Restart", riskLevel: "LOW" },
    });
    const action = await db.remediationAction.create({
      data: { resolutionId: resolution.id, status: "SUCCEEDED", idempotencyKey: id },
    });
    await db.verification.create({
      data: {
        remediationActionId: action.id,
        status: "PASSED",
        expectedState: "{}",
        actualState: "{}",
      },
    });
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await closeIncidentSource(db, secrets, integration.tenantId, id);
    expect((await db.incident.findUniqueOrThrow({ where: { id } })).sourceSyncStatus).toBe("RETRY");
    fetchMock
      .mockResolvedValueOnce(json(issue()))
      .mockResolvedValueOnce(
        json({ transitions: [{ id: "31", to: { statusCategory: { key: "done" } } }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        json({
          ...issue(),
          fields: { ...issue().fields, status: { name: "Done", statusCategory: { key: "done" } } },
        }),
      );
    await closeIncidentSource(db, secrets, integration.tenantId, id);
    expect((await db.incident.findUniqueOrThrow({ where: { id } })).sourceSyncStatus).toBe(
      "SYNCED",
    );
    const count = fetchMock.mock.calls.length;
    await closeIncidentSource(db, secrets, integration.tenantId, id);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
});
