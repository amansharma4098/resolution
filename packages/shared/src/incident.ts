import { z } from "zod";

// Kept in sync by hand with packages/database/prisma/schema.prisma enums (IncidentSourceType,
// Severity, Priority, IncidentStatus, MapServerType). A schema drift test in
// packages/shared/src/__tests__ (Phase 1) diffs these against the Prisma DMMF so the two
// can never silently disagree.

export const IncidentSourceType = z.enum(["JIRA", "SERVICENOW", "PAGERDUTY", "WEBHOOK"]);
export type IncidentSourceType = z.infer<typeof IncidentSourceType>;

export const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type Severity = z.infer<typeof Severity>;

export const Priority = z.enum(["P1", "P2", "P3", "P4"]);
export type Priority = z.infer<typeof Priority>;

export const IncidentStatus = z.enum([
  "NEW",
  "INVESTIGATING",
  "RCA_COMPLETE",
  "PENDING_APPROVAL",
  "REMEDIATING",
  "VERIFYING",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
  "FAILED",
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const MapServerType = z.enum([
  "FABRIC",
  "DATABRICKS",
  "SNOWFLAKE",
  "AZURE",
  "AWS",
  "GCP",
  "KUBERNETES",
  "DATADOG",
  "SPLUNK",
  "DYNATRACE",
  "NEW_RELIC",
  "AIRFLOW",
  "CUSTOM",
]);
export type MapServerType = z.infer<typeof MapServerType>;

/**
 * Every incident source adapter (packages/integrations/*) must normalize its raw payload
 * into exactly this shape before it reaches the orchestrator — ARCHITECTURE.md §8. Nothing
 * downstream of ingestion is allowed to branch on `source`; source-specific fields live in
 * `metadata`.
 */
export const NormalizedIncident = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  externalId: z.string().min(1),
  source: IncidentSourceType,
  title: z.string().min(1),
  description: z.string(),
  severity: Severity,
  priority: Priority,
  status: IncidentStatus,
  service: z.string().optional(),
  environment: z.string().optional(),
  resource: z.string().optional(),
  affectedSystem: MapServerType.optional(),
  createdAt: z.coerce.date(),
  metadata: z.record(z.unknown()).default({}),
});
export type NormalizedIncident = z.infer<typeof NormalizedIncident>;
