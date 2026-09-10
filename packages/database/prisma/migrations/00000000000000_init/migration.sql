-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthenticationType" AS ENUM ('OAUTH', 'API_KEY', 'CLIENT_SECRET', 'SERVICE_PRINCIPAL', 'BASIC_AUTH', 'TOKEN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('VALID', 'INVALID', 'UNVERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MapServerType" AS ENUM ('FABRIC', 'DATABRICKS', 'SNOWFLAKE', 'AZURE', 'AWS', 'GCP', 'KUBERNETES', 'DATADOG', 'SPLUNK', 'DYNATRACE', 'NEW_RELIC', 'AIRFLOW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'UNCONFIGURED');

-- CreateEnum
CREATE TYPE "IncidentSourceType" AS ENUM ('JIRA', 'SERVICENOW', 'PAGERDUTY', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('NEW', 'INVESTIGATING', 'RCA_COMPLETE', 'PENDING_APPROVAL', 'REMEDIATING', 'VERIFYING', 'RESOLVED', 'ESCALATED', 'CLOSED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('LOG', 'METRIC', 'CONFIG', 'API_RESPONSE', 'PIPELINE_RUN', 'TRACE', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('FACT', 'INFERENCE', 'HYPOTHESIS');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PolicyBehavior" AS ENUM ('AUTO', 'APPROVAL', 'DENY');

-- CreateEnum
CREATE TYPE "ResolutionMode" AS ENUM ('OBSERVE_ONLY', 'RECOMMEND', 'HUMAN_APPROVED', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('PENDING', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('INVESTIGATION', 'KNOWLEDGE', 'CONTEXT', 'RCA', 'RESOLUTION', 'REMEDIATION', 'VERIFICATION', 'INCIDENT_UPDATE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SLACK', 'TEAMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'TEAM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "resolutionMode" "ResolutionMode" NOT NULL DEFAULT 'OBSERVE_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authenticationType" "AuthenticationType" NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "IncidentSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "credentialId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapServer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "MapServerType" NOT NULL,
    "name" TEXT NOT NULL,
    "credentialId" TEXT,
    "environments" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastHealthCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapServerCapability" (
    "id" TEXT NOT NULL,
    "mapServerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "riskLevel" "RiskLevel" NOT NULL,
    "mutating" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapServerCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT NOT NULL,
    "source" "IncidentSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'NEW',
    "service" TEXT,
    "environment" TEXT,
    "resource" TEXT,
    "affectedSystem" "MapServerType",
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvidence" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "source" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" TEXT,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationStep" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "mapServerId" TEXT,
    "capabilityKey" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "evidenceCreatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RootCauseAnalysis" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "alternativeHypotheses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RootCauseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resolution" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "mapServerId" TEXT,
    "capabilityKey" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "riskLevel" "RiskLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationAction" (
    "id" TEXT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "status" "RemediationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "remediationActionId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "reason" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "remediationActionId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "expectedState" JSONB NOT NULL DEFAULT '{}',
    "actualState" JSONB NOT NULL DEFAULT '{}',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "knowledgeDocumentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runbook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "service" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunbookStep" (
    "id" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "RunbookStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mapServerType" "MapServerType" NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "behavior" "PolicyBehavior" NOT NULL,
    "resolutionModeFloor" "ResolutionMode" NOT NULL DEFAULT 'OBSERVE_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "source" "IncidentSourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingProviderCustomerId" TEXT,
    "billingProviderSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Credential_organizationId_idx" ON "Credential"("organizationId");

-- CreateIndex
CREATE INDEX "Credential_organizationId_provider_idx" ON "Credential"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_type_idx" ON "Integration"("organizationId", "type");

-- CreateIndex
CREATE INDEX "MapServer_organizationId_idx" ON "MapServer"("organizationId");

-- CreateIndex
CREATE INDEX "MapServer_organizationId_type_idx" ON "MapServer"("organizationId", "type");

-- CreateIndex
CREATE INDEX "MapServerCapability_mapServerId_idx" ON "MapServerCapability"("mapServerId");

-- CreateIndex
CREATE UNIQUE INDEX "MapServerCapability_mapServerId_key_key" ON "MapServerCapability"("mapServerId", "key");

-- CreateIndex
CREATE INDEX "Incident_organizationId_status_idx" ON "Incident"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Incident_organizationId_createdAt_idx" ON "Incident"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_organizationId_source_externalId_key" ON "Incident"("organizationId", "source", "externalId");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentEvidence_incidentId_idx" ON "IncidentEvidence"("incidentId");

-- CreateIndex
CREATE INDEX "Investigation_incidentId_idx" ON "Investigation"("incidentId");

-- CreateIndex
CREATE INDEX "InvestigationStep_investigationId_idx" ON "InvestigationStep"("investigationId");

-- CreateIndex
CREATE INDEX "RootCauseAnalysis_incidentId_idx" ON "RootCauseAnalysis"("incidentId");

-- CreateIndex
CREATE INDEX "Resolution_incidentId_idx" ON "Resolution"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "RemediationAction_idempotencyKey_key" ON "RemediationAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RemediationAction_resolutionId_idx" ON "RemediationAction"("resolutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_remediationActionId_key" ON "Approval"("remediationActionId");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE INDEX "Verification_remediationActionId_idx" ON "Verification"("remediationActionId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_organizationId_idx" ON "KnowledgeDocument"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeEmbedding_organizationId_idx" ON "KnowledgeEmbedding"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeEmbedding_knowledgeDocumentId_idx" ON "KnowledgeEmbedding"("knowledgeDocumentId");

-- CreateIndex
CREATE INDEX "Runbook_organizationId_idx" ON "Runbook"("organizationId");

-- CreateIndex
CREATE INDEX "RunbookStep_runbookId_idx" ON "RunbookStep"("runbookId");

-- CreateIndex
CREATE INDEX "AutomationPolicy_organizationId_idx" ON "AutomationPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationPolicy_organizationId_mapServerType_capabilityKey_key" ON "AutomationPolicy"("organizationId", "mapServerType", "capabilityKey");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_idx" ON "AuditLog"("organizationId", "action");

-- CreateIndex
CREATE INDEX "AgentExecution_incidentId_idx" ON "AgentExecution"("incidentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_createdAt_idx" ON "WebhookEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_source_externalId_eventHash_key" ON "WebhookEvent"("source", "externalId", "eventHash");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageMetric_organizationId_metric_periodStart_idx" ON "UsageMetric"("organizationId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapServer" ADD CONSTRAINT "MapServer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapServer" ADD CONSTRAINT "MapServer_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapServerCapability" ADD CONSTRAINT "MapServerCapability_mapServerId_fkey" FOREIGN KEY ("mapServerId") REFERENCES "MapServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvidence" ADD CONSTRAINT "IncidentEvidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationStep" ADD CONSTRAINT "InvestigationStep_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RootCauseAnalysis" ADD CONSTRAINT "RootCauseAnalysis_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RootCauseAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationAction" ADD CONSTRAINT "RemediationAction_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "Resolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_remediationActionId_fkey" FOREIGN KEY ("remediationActionId") REFERENCES "RemediationAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_remediationActionId_fkey" FOREIGN KEY ("remediationActionId") REFERENCES "RemediationAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunbookStep" ADD CONSTRAINT "RunbookStep_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationPolicy" ADD CONSTRAINT "AutomationPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

