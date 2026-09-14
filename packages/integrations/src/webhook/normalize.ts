import { z } from "zod";
import { Severity, Priority, type NormalizedIncident } from "@resolution/shared";

/**
 * The generic inbound webhook — unlike Jira/ServiceNow, there's no vendor shape to mirror
 * here: this *is* the shape (documented in docs/webhooks.md), for any system that doesn't
 * have a bespoke connector (an in-house tool, a script, a monitoring system with a
 * configurable webhook body). `externalId` is required rather than generated, the same way
 * Jira's issue key / ServiceNow's incident number are the caller's own identifier — it's
 * what makes redelivery idempotent (Incident's unique (tenantId, source, externalId)
 * — see IncidentRepository.findByExternalId), so a caller that doesn't send a stable one
 * would get a duplicate Incident on every retry.
 */
export const GenericWebhookPayloadSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  severity: Severity.default("MEDIUM"),
  priority: Priority.default("P3"),
  service: z.string().optional(),
  environment: z.string().optional(),
  resource: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type GenericWebhookPayload = z.infer<typeof GenericWebhookPayloadSchema>;

/**
 * Unlike Jira/ServiceNow's normalizers (which can return `null` for a webhook event this
 * platform doesn't care about, e.g. an issue transition), a generic webhook payload that
 * doesn't validate is always an error worth surfacing immediately — see
 * apps/api/src/routes/webhooks.ts's `/webhook/:integrationId`, which validates with
 * `GenericWebhookPayloadSchema` and returns 400 synchronously rather than accepting garbage
 * and silently ignoring it later. This function assumes an already-valid payload.
 */
export function normalizeGenericWebhook(
  payload: GenericWebhookPayload,
): Omit<NormalizedIncident, "id" | "tenantId" | "createdAt"> {
  return {
    externalId: payload.externalId,
    source: "WEBHOOK",
    title: payload.title,
    description: payload.description,
    severity: payload.severity,
    priority: payload.priority,
    status: "NEW",
    service: payload.service,
    environment: payload.environment,
    resource: payload.resource,
    metadata: payload.metadata,
  };
}
