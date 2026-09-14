-- Renames the tenant-scoping column from "organizationId" to "tenantId" on every
-- tenant-owned table, for naming consistency between the database, the application code,
-- and every log line (Organization remains the model/entity name — this is a pure column
-- rename of the scoping FK, not a rename of the Organization concept itself). A genuinely
-- incremental change against already-applied production data — SQLite/D1 supports
-- ALTER TABLE ... RENAME COLUMN natively (3.25.0+), so this is a plain, safe,
-- single-statement operation per table rather than the from-empty diff-tool machinery.
ALTER TABLE "OrganizationMember" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Credential" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Integration" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "MapServer" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Incident" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "KnowledgeDocument" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "KnowledgeEmbedding" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Runbook" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "AutomationPolicy" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "AuditLog" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "WebhookEvent" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Notification" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "UsageMetric" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Subscription" RENAME COLUMN "organizationId" TO "tenantId";

-- SQLite's RENAME COLUMN already updates every index/unique-constraint definition that
-- referenced the old column name in place (including the compound ones — e.g.
-- OrganizationMember's (organizationId, userId) unique index becomes (tenantId, userId)
-- automatically) — no separate DROP/CREATE INDEX statements are needed.
