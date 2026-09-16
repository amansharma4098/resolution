import {
  AutomationPolicyRepository,
  CredentialRepository,
  IncidentRepository,
  MapServerRepository,
  OrganizationRepository,
  type PrismaClient,
} from "@resolution/database";
import { evaluatePolicy } from "@resolution/agents";
import type { ResolutionMode } from "@resolution/shared";
import { ConflictError } from "./errors";

/** Recheck current authority after an approval wait and immediately before execution. */
export async function assertExecutionAllowed(
  db: PrismaClient,
  input: {
    tenantId: string;
    incidentId: string;
    mapServerId: string;
    capabilityKey: string;
    approved: boolean;
  },
) {
  const servers = new MapServerRepository(db, input.tenantId);
  const server = await servers.findById(input.mapServerId);
  if (!server || server.config.disabled)
    throw new ConflictError("Connection is disabled or no longer exists");
  const incident = await new IncidentRepository(db, input.tenantId).findById(input.incidentId);
  if (!incident) throw new ConflictError("Incident no longer exists");
  if (incident.environment && !server.environments.includes(incident.environment))
    throw new ConflictError("Connection does not permit this environment");
  const capabilities = await servers.listCapabilities(server.id);
  if (!capabilities.some((c) => c.key === input.capabilityKey && c.enabled && c.mutating))
    throw new ConflictError("Write capability is no longer enabled");
  if (
    server.credentialId &&
    !(await new CredentialRepository(db, input.tenantId).findUsableById(server.credentialId))
  )
    throw new ConflictError("Credential is missing, expired or revoked");
  const org = await new OrganizationRepository(db).findById(input.tenantId);
  const policy = await new AutomationPolicyRepository(db, input.tenantId).findForCapability(
    server.type,
    input.capabilityKey,
  );
  const behavior = evaluatePolicy(
    (org?.resolutionMode ?? "OBSERVE_ONLY") as ResolutionMode,
    policy ?? undefined,
  );
  if (behavior === "DENY" || (behavior === "APPROVAL" && !input.approved))
    throw new ConflictError("Current tenant policy does not authorize this execution");
}
