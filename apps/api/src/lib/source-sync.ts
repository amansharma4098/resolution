import {
  CredentialRepository,
  IntegrationRepository,
  type Integration,
  type PrismaClient,
} from "@resolution/database";
import type { SecretProvider } from "@resolution/credentials";
import {
  AzureMonitorClient,
  azureAlertPayload,
  JiraClient,
  ServiceNowClient,
  validateSourceUrl,
} from "@resolution/integrations";
import type { IncidentIngestionQueue, IngestionSource } from "../queue/types";

export const POLLING_SOURCES = new Set(["JIRA", "AZURE_MONITOR", "SERVICENOW"]);

export function validateSourceSettings(
  type: string,
  config: Record<string, unknown>,
  syncEnabled: boolean,
  credentialId?: string | null,
): void {
  if (syncEnabled && !POLLING_SOURCES.has(type))
    throw new Error("This source receives webhooks; scheduled collection is unavailable");
  if (syncEnabled && !credentialId)
    throw new Error("Select a credential before enabling scheduled collection");
  if (
    ["JIRA", "SERVICENOW"].includes(type) &&
    (config.baseUrl || syncEnabled || config.autoClose)
  ) {
    validateSourceUrl(String(config.baseUrl ?? ""), type as "JIRA" | "SERVICENOW");
  }
  if (
    type === "AZURE_MONITOR" &&
    (syncEnabled || config.autoClose) &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      String(config.subscriptionId ?? ""),
    )
  )
    throw new Error("Enter an Azure subscription UUID");
  if (config.autoClose && !POLLING_SOURCES.has(type))
    throw new Error("Automatic source closure is supported for Jira, Azure Monitor and ServiceNow");
  if (config.autoClose && !credentialId)
    throw new Error("Automatic source closure requires a credential");
  if (
    config.autoClose &&
    type === "JIRA" &&
    !/^\d+$/.test(String(config.resolutionTransitionId ?? ""))
  )
    throw new Error("Specify the Jira transition ID that leads to a Done status");
  if (config.autoClose && type === "SERVICENOW" && !config.closeCode)
    throw new Error("Specify your ServiceNow resolution close code");
  if (config.autoClose !== undefined && typeof config.autoClose !== "boolean")
    throw new Error("autoClose must be a boolean");
  for (const key of ["environment", "service", "jql", "closeCode"]) {
    if (
      config[key] !== undefined &&
      (typeof config[key] !== "string" || String(config[key]).length > 2000)
    )
      throw new Error(`Invalid ${key}`);
  }
}

export async function sourceClient(db: PrismaClient, secrets: SecretProvider, source: Integration) {
  if (!source.credentialId) throw new Error("No credential attached to this source");
  const row = await new CredentialRepository(db, source.tenantId).findUsableById(
    source.credentialId,
  );
  if (!row) throw new Error("Source credential is missing, expired or revoked");
  const credential = await secrets.decrypt(row.encryptedData, { tenantId: source.tenantId });
  if (source.type === "AZURE_MONITOR")
    return new AzureMonitorClient(String(source.config.subscriptionId ?? ""), credential);
  if (source.type === "JIRA")
    return new JiraClient(String(source.config.baseUrl ?? ""), {
      email: String(credential.username ?? credential.email ?? ""),
      apiToken: String(credential.password ?? credential.apiToken ?? ""),
    });
  if (source.type === "SERVICENOW")
    return new ServiceNowClient(String(source.config.baseUrl ?? ""), {
      username: String(credential.username ?? ""),
      password: String(credential.password ?? ""),
    });
  throw new Error("Source does not support collection");
}

/** One bounded page per queue delivery; the persisted cursor prevents starving older pages. */
export async function syncSource(
  db: PrismaClient,
  secrets: SecretProvider,
  queue: IncidentIngestionQueue,
  id: string,
): Promise<void> {
  const source = await IntegrationRepository.findByIdUnscoped(db, id);
  if (!source || !source.syncEnabled || !POLLING_SOURCES.has(source.type)) return;
  const lease = Date.now() + 120_000;
  const claim = await db.integration.updateMany({
    where: { id, syncEnabled: true, syncLockedUntil: { lte: Date.now() } },
    data: { syncLockedUntil: lease },
  });
  if (!claim.count) return;
  try {
    const row = await db.integration.findUniqueOrThrow({ where: { id } });
    const client = await sourceClient(db, secrets, source);
    let payloads: unknown[];
    let cursor: string | null = null;
    if (client instanceof JiraClient) {
      const filter = String(source.config.jql || "statusCategory != Done ORDER BY created ASC");
      const page = await client.searchIssues(filter, row.syncCursor ?? undefined);
      payloads = page.issues
        .filter((issue) => issue.fields.status.statusCategory?.key !== "done")
        .map((issue) => ({ webhookEvent: "jira:issue_updated", issue }));
      cursor = page.nextPageToken || null;
    } else if (client instanceof AzureMonitorClient) {
      const page = await client.listAlerts(row.syncCursor ?? undefined);
      payloads = page.value.map(azureAlertPayload);
      cursor = page.nextLink || null;
    } else {
      const offset = Number(row.syncCursor ?? 0);
      const page = await client.listIncidents(offset);
      payloads = page.filter((incident) => !["6", "7", "8"].includes(incident.state ?? ""));
      cursor = page.length === 100 ? String(offset + 100) : null;
    }
    if (payloads.length > 100) throw new Error("Source returned more than 100 records in one page");
    for (const payload of payloads)
      await queue.send({
        source: source.type as IngestionSource,
        integrationId: id,
        rawBody: JSON.stringify(payload),
      });
    await db.integration.updateMany({
      where: { id, syncLockedUntil: lease },
      data: {
        lastSyncedAt: new Date(),
        syncCursor: cursor,
        syncError: null,
        status: "CONNECTED",
      },
    });
  } catch (error) {
    // No provider response bodies or decrypted secrets in customer-visible errors.
    const detail = error instanceof Error ? error.message : "Source collection failed";
    await db.integration.updateMany({
      where: { id, syncLockedUntil: lease },
      data: {
        syncError: detail.slice(0, 300),
        status: "DEGRADED",
        syncCursor: null,
      },
    });
    throw error;
  } finally {
    await db.integration.updateMany({
      where: { id, syncLockedUntil: lease },
      data: { syncLockedUntil: 0 },
    });
  }
}
