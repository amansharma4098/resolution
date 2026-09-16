import { z } from "zod";
import type { NormalizedIncident } from "@resolution/shared";
import type { AzureAlert } from "./client";

export const AzureMonitorPayload = z.object({
  schemaId: z.literal("azureMonitorCommonAlertSchema"),
  data: z
    .object({
      essentials: z
        .object({
          alertId: z.string().min(1),
          alertRule: z.string().min(1),
          severity: z.string(),
          monitorCondition: z.enum(["Fired", "Resolved"]),
          description: z.string().optional(),
          alertTargetIDs: z.array(z.string()).optional(),
          firedDateTime: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
});
export function azureAlertPayload(alert: AzureAlert): unknown {
  const e = alert.properties.essentials;
  return {
    schemaId: "azureMonitorCommonAlertSchema",
    data: {
      essentials: {
        alertId: alert.id,
        alertRule: e.alertRule || alert.name,
        severity: e.severity,
        monitorCondition: e.monitorCondition,
        description: e.description,
        alertTargetIDs: e.targetResource ? [e.targetResource] : [],
        firedDateTime: e.startDateTime,
        sourceUpdatedAt: e.lastModifiedDateTime,
      },
    },
  };
}
export function normalizeAzureMonitor(
  payload: unknown,
): Omit<NormalizedIncident, "id" | "tenantId" | "createdAt"> | null {
  const {
    data: { essentials: e },
  } = AzureMonitorPayload.parse(payload);
  if (e.monitorCondition !== "Fired") return null;
  const severity =
    e.severity === "Sev0"
      ? "CRITICAL"
      : e.severity === "Sev1"
        ? "HIGH"
        : e.severity === "Sev2"
          ? "MEDIUM"
          : "LOW";
  return {
    externalId: e.alertId,
    source: "AZURE_MONITOR",
    title: e.alertRule,
    description: e.description ?? e.alertRule,
    severity,
    priority:
      severity === "CRITICAL"
        ? "P1"
        : severity === "HIGH"
          ? "P2"
          : severity === "MEDIUM"
            ? "P3"
            : "P4",
    status: "NEW",
    resource: e.alertTargetIDs?.[0],
    affectedSystem: "AZURE",
    metadata: {
      azureAlertId: e.alertId,
      monitorCondition: e.monitorCondition,
      firedDateTime: e.firedDateTime ?? null,
    },
  };
}
