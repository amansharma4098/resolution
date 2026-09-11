import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { processInvestigationMessage } from "../queue/investigation-consumer";
import { createFakeDb } from "./fake-db";

const workspaceProvider: MapServerProvider = {
  type: "FABRIC",
  metadata: { displayName: "Fabric (fixture)", isMock: false },
  configSchema: z.object({}),
  authAdapter: { authenticationTypes: ["SERVICE_PRINCIPAL"], testConnection: async () => ({ status: "CONNECTED" }) },
  capabilities: [
    {
      key: "get_workspace",
      description: "Fetch a workspace",
      riskLevel: "LOW",
      mutating: false,
      inputSchema: z.object({ workspaceId: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      execute: async (_ctx, input) => ({ id: (input as { workspaceId: string }).workspaceId }),
    },
    {
      key: "retry_pipeline",
      description: "Retry a failed pipeline",
      riskLevel: "HIGH",
      mutating: true,
      inputSchema: z.object({ pipelineId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    },
  ],
  healthCheck: async () => ({ status: "CONNECTED" }),
};

describe("processInvestigationMessage", () => {
  afterEach(() => {
    __resetRegistryForTests();
  });

  async function setup() {
    const db = createFakeDb();
    const prismaDb = db as unknown as PrismaClient;
    const org = await db.organization.create({ data: { name: "Acme", slug: "acme" } });
    const incident = await db.incident.create({
      data: {
        organizationId: org.id,
        externalId: "OPS-1",
        source: "JIRA",
        title: "Nightly pipeline failing",
        description: "Timeout after 30 minutes",
        severity: "HIGH",
        priority: "P2",
        status: "NEW",
      },
    });
    return { db, prismaDb, org, incident };
  }

  it("investigates with MOCK_MODE, calling only read-only enabled capabilities and recording evidence + RCA", async () => {
    registerMapServer(workspaceProvider);
    const { db, prismaDb, org, incident } = await setup();

    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "get_workspace", riskLevel: "LOW", mutating: false, enabled: true },
    });
    // Enabled but mutating — must never be offered to the investigation agent.
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "HIGH", mutating: true, enabled: true },
    });

    const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
    await processInvestigationMessage(
      prismaDb,
      { mockMode: true, secretProvider },
      { incidentId: incident.id, organizationId: org.id },
    );

    const updated = db._debug.incidents.find((i) => i.id === incident.id)!;
    expect(updated.status).toBe("RCA_COMPLETE");

    expect(db._debug.incidentEvidence.length).toBeGreaterThan(0);
    expect(db._debug.incidentEvidence.every((e) => e.capabilityKey !== "retry_pipeline")).toBe(true);

    expect(db._debug.rootCauseAnalyses).toHaveLength(1);
    const rca = db._debug.rootCauseAnalyses[0]!;
    expect(rca.incidentId).toBe(incident.id);
    const claims = JSON.parse(rca.claims);
    expect(claims.length).toBeGreaterThan(0);

    const events = db._debug.incidentEvents.filter((e) => e.incidentId === incident.id).map((e) => e.type);
    expect(events).toContain("status_changed");
    expect(events).toContain("rca_completed");

    expect(db._debug.auditLogs.some((a) => (a as { action: string }).action === "incident.rca_completed")).toBe(
      true,
    );
  });

  it("investigates with no Map Servers at all (still produces a valid, low-confidence RCA)", async () => {
    const { db, prismaDb, org, incident } = await setup();
    const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));

    await processInvestigationMessage(
      prismaDb,
      { mockMode: true, secretProvider },
      { incidentId: incident.id, organizationId: org.id },
    );

    const updated = db._debug.incidents.find((i) => i.id === incident.id)!;
    expect(updated.status).toBe("RCA_COMPLETE");
    expect(db._debug.incidentEvidence).toHaveLength(0);
    expect(db._debug.rootCauseAnalyses).toHaveLength(1);
  });

  it("is a no-op for an incident that isn't NEW (redelivery safety)", async () => {
    const { db, prismaDb, org, incident } = await setup();
    await db.incident.update({ where: { id: incident.id }, data: { status: "RESOLVED" } });
    const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));

    await processInvestigationMessage(
      prismaDb,
      { mockMode: true, secretProvider },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.rootCauseAnalyses).toHaveLength(0);
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RESOLVED");
  });

  it("escalates (never throws out of the consumer) when the agent can't converge on an RCA", async () => {
    const { db, prismaDb, org, incident } = await setup();
    const secretProvider = new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
    // A deterministic client that never calls a tool — the agent loop exhausts
    // maxIterations and throws InvestigationIncompleteError, which this consumer must
    // catch and turn into an ESCALATED status, not an unhandled rejection.
    const stuckLlmClient = {
      isMock: true,
      async send() {
        return {
          stopReason: "end_turn" as const,
          content: [{ type: "text" as const, text: "still thinking", citations: [] }],
          toolUses: [],
        };
      },
    };

    await processInvestigationMessage(
      prismaDb,
      { mockMode: true, secretProvider, llmClient: stuckLlmClient },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("ESCALATED");
    expect(db._debug.rootCauseAnalyses).toHaveLength(0);
    const events = db._debug.incidentEvents.filter((e) => e.incidentId === incident.id);
    const lastEvent = events[events.length - 1]!;
    expect(JSON.parse(lastEvent.detail)).toMatchObject({ from: "INVESTIGATING", to: "ESCALATED" });
    expect(
      db._debug.auditLogs.some((a) => (a as { action: string }).action === "incident.investigation_failed"),
    ).toBe(true);
  });
});
