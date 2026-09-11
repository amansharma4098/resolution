import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { EncryptedDbSecretProvider } from "@resolution/credentials";
import { __resetRegistryForTests, registerMapServer, type MapServerProvider } from "@resolution/map-servers";
import { processRemediationMessage } from "../queue/remediation-consumer";
import { createFakeDb } from "./fake-db";

function fixtureProvider(retryExecute?: () => Promise<{ jobInstanceId: string }>): MapServerProvider {
  return {
    type: "FABRIC",
    metadata: { displayName: "Fabric (fixture)", isMock: false },
    configSchema: z.object({}),
    authAdapter: { authenticationTypes: ["SERVICE_PRINCIPAL"], testConnection: async () => ({ status: "CONNECTED" }) },
    capabilities: [
      {
        key: "retry_pipeline",
        description: "Retry a failed pipeline",
        riskLevel: "LOW",
        mutating: true,
        inputSchema: z.object({ pipelineId: z.string().min(1) }),
        outputSchema: z.object({ jobInstanceId: z.string() }),
        execute: retryExecute ?? (async () => ({ jobInstanceId: "job1" })),
        verification: {
          capabilityKey: "get_pipeline_run",
          buildInput: (_input: unknown, output: unknown) => ({
            jobInstanceId: (output as { jobInstanceId: string }).jobInstanceId,
          }),
          classify: (out: unknown) => {
            const status = (out as { status: string }).status;
            if (status === "Completed") return "PASSED";
            if (status === "Failed") return "FAILED";
            return "RETRYING";
          },
        },
      },
      {
        key: "get_pipeline_run",
        description: "Get pipeline run status",
        riskLevel: "LOW",
        mutating: false,
        inputSchema: z.object({ jobInstanceId: z.string() }),
        outputSchema: z.object({ status: z.string() }),
        execute: async (_ctx, rawInput: unknown) => {
          const input = rawInput as { jobInstanceId: string };
          return { status: statusFor(input.jobInstanceId) };
        },
      },
    ],
    healthCheck: async () => ({ status: "CONNECTED" }),
  } as MapServerProvider;
}

// Controls what get_pipeline_run reports for a given jobInstanceId across the fixture's
// lifetime — lets individual tests script PASSED/FAILED/RETRYING-then-PASSED sequences.
let jobStatusScript: Record<string, string[]> = {};
function statusFor(jobInstanceId: string): string {
  const script = jobStatusScript[jobInstanceId];
  if (!script || script.length === 0) return "Completed";
  return script.length > 1 ? script.shift()! : script[0]!;
}

async function setup() {
  const db = createFakeDb();
  const prismaDb = db as unknown as PrismaClient;
  const org = await db.organization.create({ data: { name: "Acme", slug: "acme" } });
  const rca = await db.rootCauseAnalysis.create({
    data: {
      incidentId: "placeholder", // set below once the incident exists
      summary: "Pipeline stalled",
      claims: JSON.stringify([{ text: "x", claimType: "HYPOTHESIS", evidenceIds: [], confidence: 0.3 }]),
      confidence: 0.3,
      alternativeHypotheses: "[]",
    },
  });
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      externalId: "OPS-1",
      source: "JIRA",
      title: "Nightly pipeline failing",
      description: "Timeout after 30 minutes",
      severity: "HIGH",
      priority: "P2",
      status: "RCA_COMPLETE",
    },
  });
  rca.incidentId = incident.id;
  return { db, prismaDb, org, incident, rca };
}

function secretProvider() {
  return new EncryptedDbSecretProvider(randomBytes(32).toString("base64"));
}

describe("processRemediationMessage", () => {
  afterEach(() => {
    __resetRegistryForTests();
    jobStatusScript = {};
  });

  it("is a no-op for an incident that isn't RCA_COMPLETE (redelivery safety)", async () => {
    const { db, prismaDb, org, incident } = await setup();
    await db.incident.update({ where: { id: incident.id }, data: { status: "RESOLVED" } });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider() },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.resolutions).toHaveLength(0);
  });

  it("proposes no action and leaves the incident at RCA_COMPLETE when there are no mutating capabilities", async () => {
    const { db, prismaDb, org, incident } = await setup();

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider() },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.resolutions).toHaveLength(0);
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RCA_COMPLETE");
    const events = db._debug.incidentEvents.filter((e) => e.incidentId === incident.id).map((e) => e.type);
    expect(events).toContain("remediation_not_proposed");
  });

  it("DENY: default org mode (OBSERVE_ONLY) denies even a proposed remediation, RemediationAction stays PENDING", async () => {
    registerMapServer(fixtureProvider());
    const { db, prismaDb, org, incident } = await setup();
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider() },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.resolutions).toHaveLength(1);
    expect(db._debug.remediationActions).toHaveLength(1);
    expect(db._debug.remediationActions[0]!.status).toBe("PENDING");
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RCA_COMPLETE");
    const events = db._debug.incidentEvents.filter((e) => e.incidentId === incident.id).map((e) => e.type);
    expect(events).toContain("remediation_denied_by_policy");
  });

  it("APPROVAL: RECOMMEND mode with the default policy creates an Approval and moves to PENDING_APPROVAL", async () => {
    registerMapServer(fixtureProvider());
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "RECOMMEND" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider() },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.approvals).toHaveLength(1);
    expect(db._debug.approvals[0]!.status).toBe("PENDING");
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("PENDING_APPROVAL");
  });

  it("AUTO: AUTONOMOUS mode + an AUTO policy executes and verifies (PASSED -> RESOLVED)", async () => {
    registerMapServer(fixtureProvider());
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "AUTONOMOUS" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });
    await db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: org.id,
          mapServerType: "FABRIC",
          capabilityKey: "retry_pipeline",
        },
      },
      create: {
        riskLevel: "LOW",
        behavior: "AUTO",
        resolutionModeFloor: "AUTONOMOUS",
      },
      update: {},
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider(), sleep: async () => {} },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.remediationActions[0]!.status).toBe("SUCCEEDED");
    expect(db._debug.verifications).toHaveLength(1);
    expect(db._debug.verifications[0]!.status).toBe("PASSED");
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RESOLVED");
    const events = db._debug.incidentEvents.filter((e) => e.incidentId === incident.id).map((e) => e.type);
    expect(events).toEqual(
      expect.arrayContaining(["remediation_proposed", "remediation_executed", "resolved"]),
    );
  });

  it("AUTO: verification RETRYING then PASSED converges to RESOLVED within the bounded retry loop", async () => {
    registerMapServer(fixtureProvider());
    jobStatusScript = { job1: ["InProgress", "Completed"] };
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "AUTONOMOUS" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });
    await db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: org.id,
          mapServerType: "FABRIC",
          capabilityKey: "retry_pipeline",
        },
      },
      create: { riskLevel: "LOW", behavior: "AUTO", resolutionModeFloor: "AUTONOMOUS" },
      update: {},
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider(), sleep: async () => {} },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.verifications.map((v) => v.status)).toEqual(["RETRYING", "PASSED"]);
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RESOLVED");
  });

  it("AUTO: verification FAILED escalates instead of resolving", async () => {
    registerMapServer(fixtureProvider());
    jobStatusScript = { job1: ["Failed"] };
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "AUTONOMOUS" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });
    await db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: org.id,
          mapServerType: "FABRIC",
          capabilityKey: "retry_pipeline",
        },
      },
      create: { riskLevel: "LOW", behavior: "AUTO", resolutionModeFloor: "AUTONOMOUS" },
      update: {},
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider(), sleep: async () => {} },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.verifications[0]!.status).toBe("FAILED");
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("ESCALATED");
  });

  it("AUTO: a capability with no verification companion resolves honestly as unverified", async () => {
    const noVerifyProvider: MapServerProvider = {
      type: "FABRIC",
      metadata: { displayName: "Fabric (fixture, no verification)", isMock: false },
      configSchema: z.object({}),
      authAdapter: { authenticationTypes: ["SERVICE_PRINCIPAL"], testConnection: async () => ({ status: "CONNECTED" }) },
      capabilities: [
        {
          key: "retry_pipeline",
          description: "Retry a failed pipeline",
          riskLevel: "LOW",
          mutating: true,
          inputSchema: z.object({ pipelineId: z.string().min(1) }),
          outputSchema: z.object({ jobInstanceId: z.string() }),
          execute: async () => ({ jobInstanceId: "job1" }),
        },
      ],
      healthCheck: async () => ({ status: "CONNECTED" }),
    };
    registerMapServer(noVerifyProvider);
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "AUTONOMOUS" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });
    await db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: org.id,
          mapServerType: "FABRIC",
          capabilityKey: "retry_pipeline",
        },
      },
      create: { riskLevel: "LOW", behavior: "AUTO", resolutionModeFloor: "AUTONOMOUS" },
      update: {},
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider(), sleep: async () => {} },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.verifications).toHaveLength(0);
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("RESOLVED");
    const resolvedEvent = db._debug.incidentEvents.find((e) => e.type === "resolved")!;
    expect(JSON.parse(resolvedEvent.detail)).toMatchObject({ verified: false });
  });

  it("AUTO: execution throwing marks the incident FAILED, not stuck in REMEDIATING", async () => {
    registerMapServer(
      fixtureProvider(async () => {
        throw new Error("upstream 500");
      }),
    );
    const { db, prismaDb, org, incident } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { resolutionMode: "AUTONOMOUS" } });
    const mapServer = await db.mapServer.create({
      data: { organizationId: org.id, type: "FABRIC", name: "Prod Fabric", environments: ["prod"] },
    });
    await db.mapServerCapability.create({
      data: { mapServerId: mapServer.id, key: "retry_pipeline", riskLevel: "LOW", mutating: true, enabled: true },
    });
    await db.automationPolicy.upsert({
      where: {
        organizationId_mapServerType_capabilityKey: {
          organizationId: org.id,
          mapServerType: "FABRIC",
          capabilityKey: "retry_pipeline",
        },
      },
      create: { riskLevel: "LOW", behavior: "AUTO", resolutionModeFloor: "AUTONOMOUS" },
      update: {},
    });

    await processRemediationMessage(
      prismaDb,
      { mockMode: true, secretProvider: secretProvider(), sleep: async () => {} },
      { incidentId: incident.id, organizationId: org.id },
    );

    expect(db._debug.remediationActions[0]!.status).toBe("FAILED");
    expect(db._debug.incidents.find((i) => i.id === incident.id)!.status).toBe("FAILED");
  });
});
