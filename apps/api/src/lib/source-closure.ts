import { IntegrationRepository, parseJsonField, type PrismaClient } from "@resolution/database";
import type { SecretProvider } from "@resolution/credentials";
import { AzureMonitorClient, JiraClient } from "@resolution/integrations";
import { sourceClient } from "./source-sync";

/** Durable, retryable source closure. Never infer recovery from a successful write. */
export async function closeIncidentSource(
  db: PrismaClient,
  secrets: SecretProvider,
  tenantId: string,
  incidentId: string,
): Promise<void> {
  const incident = await db.incident.findFirst({
    where: { id: incidentId, tenantId, status: "RESOLVED" },
  });
  if (!incident || incident.sourceSyncStatus === "SYNCED") return;
  if (!incident.integrationId) {
    await db.incident.update({
      where: { id: incidentId },
      data: { sourceSyncStatus: "NOT_REQUESTED" },
    });
    return;
  }
  const source = await new IntegrationRepository(db, tenantId).findById(incident.integrationId);
  if (!source || source.config.autoClose !== true || source.config.disabled === true) {
    await db.incident.updateMany({
      where: { id: incidentId, tenantId, sourceSyncStatus: { not: "SYNCED" } },
      data: { sourceSyncStatus: "NOT_REQUESTED" },
    });
    return;
  }
  const proof = await db.verification.findFirst({
    where: {
      status: "PASSED",
      remediationAction: { status: "SUCCEEDED", resolution: { incidentId } },
    },
    orderBy: { checkedAt: "desc" },
  });
  if (!proof) {
    await db.incident.update({
      where: { id: incidentId },
      data: { sourceSyncStatus: "NOT_REQUESTED" },
    });
    return;
  }
  const lease = Date.now() + 120_000;
  const claim = await db.incident.updateMany({
    where: {
      id: incidentId,
      tenantId,
      status: "RESOLVED",
      sourceSyncStatus: { not: "SYNCED" },
      sourceSyncLockedUntil: { lte: Date.now() },
    },
    data: { sourceSyncLockedUntil: lease, sourceSyncStatus: "PENDING" },
  });
  if (!claim.count) return;
  try {
    const client = await sourceClient(db, secrets, source);
    const note = `FixCaptain verified recovery. Incident ${incident.id}; verification ${proof.id}.`;
    if (client instanceof JiraClient) {
      const current = await client.getIssue(incident.externalId);
      if (current.fields.status.statusCategory?.key !== "done") {
        const transition = (await client.listTransitions(incident.externalId)).find(
          (t) => t.id === source.config.resolutionTransitionId,
        );
        if (transition?.to?.statusCategory?.key !== "done")
          throw new Error("Configured Jira transition is unavailable or does not lead to Done");
        await client.transitionIssue(incident.externalId, transition.id);
        if (
          (await client.getIssue(incident.externalId)).fields.status.statusCategory?.key !== "done"
        )
          throw new Error("Jira has not confirmed the Done status");
      }
    } else if (client instanceof AzureMonitorClient) {
      await client.closeAlert(incident.externalId, note);
    } else {
      const metadata = parseJsonField<Record<string, unknown>>(incident.metadata, {});
      if (!metadata.serviceNowSysId || !source.config.closeCode)
        throw new Error("ServiceNow incident ID or resolution code is missing");
      await client.resolveIncident(
        String(metadata.serviceNowSysId),
        String(source.config.closeCode),
        note,
      );
    }
    await db.incident.updateMany({
      where: { id: incidentId, sourceSyncLockedUntil: lease },
      data: {
        sourceSyncStatus: "SYNCED",
        sourceSyncError: null,
        sourceSyncedAt: new Date(),
      },
    });
    await db.incidentEvent.create({
      data: {
        incidentId,
        actor: "system",
        type: "source_resolved",
        detail: JSON.stringify({ source: source.type, verificationId: proof.id }),
      },
    });
  } catch (error) {
    await db.incident.updateMany({
      where: { id: incidentId, sourceSyncLockedUntil: lease },
      data: {
        sourceSyncStatus: "RETRY",
        sourceSyncError: (error instanceof Error ? error.message : "Source closure failed").slice(
          0,
          300,
        ),
      },
    });
  } finally {
    await db.incident.updateMany({
      where: { id: incidentId, sourceSyncLockedUntil: lease },
      data: { sourceSyncLockedUntil: 0 },
    });
  }
}
