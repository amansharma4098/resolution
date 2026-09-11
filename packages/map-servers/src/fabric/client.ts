/**
 * A thin wrapper over the Microsoft Fabric REST API — no SDK, just typed fetch calls.
 * Auth is Azure AD OAuth2 client-credentials (a Fabric-enabled service principal),
 * matching `authenticationType: SERVICE_PRINCIPAL` in the Credential payload (tenantId,
 * clientId, clientSecret).
 *
 * The Fabric REST API is newer and less standardized than Jira's or ServiceNow's — this
 * follows Microsoft's published API structure (workspaces, items, and the Job Scheduler
 * API for pipeline runs) as closely as the public docs allow, but has NOT been exercised
 * against a live Fabric tenant in this environment (no test tenant was available). Flagged
 * with extra care here specifically because Fabric's public API surface is less mature
 * than Jira/ServiceNow's, so the risk of a shape mismatch against a real tenant is higher.
 */
export interface FabricWorkspace {
  id: string;
  displayName: string;
  description?: string;
  type: string;
}

export interface FabricItem {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

export interface FabricJobInstance {
  id: string;
  itemId: string;
  jobType: string;
  status: string; // "NotStarted" | "InProgress" | "Completed" | "Failed" | "Cancelled" | "Deduped"
  startTimeUtc?: string;
  endTimeUtc?: string;
  failureReason?: { errorCode?: string; message?: string } | null;
}

export class FabricApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FabricApiError";
  }
}

const FABRIC_API_BASE = "https://api.fabric.microsoft.com/v1";
const AAD_SCOPE = "https://api.fabric.microsoft.com/.default";

export interface FabricServicePrincipalCredential {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Azure AD OAuth2 client-credentials token acquisition — real network call, not stubbed.
 *  Token endpoint and grant type are Microsoft's standard v2.0 token endpoint, not
 *  Fabric-specific, so this part is on solid, well-documented ground even though the
 *  Fabric API calls it authorizes are less so. */
export async function getFabricAccessToken(credential: FabricServicePrincipalCredential): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${credential.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      scope: AAD_SCOPE,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FabricApiError(`Azure AD token request failed (${res.status}): ${body.slice(0, 500)}`, res.status);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export class FabricClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${FABRIC_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FabricApiError(`Fabric API ${path} returned ${res.status}: ${body.slice(0, 500)}`, res.status);
    }
    if (res.status === 202 || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async getWorkspace(workspaceId: string): Promise<FabricWorkspace> {
    return this.request(`/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  /** Lists every workspace the service principal can see — used as the health check
   *  (ARCHITECTURE.md §4's MapServerContext carries no org-configured workspaceId, so a
   *  connectivity check can't target one specific workspace; listing is real and
   *  config-independent). */
  async listWorkspaces(): Promise<{ value: FabricWorkspace[] }> {
    return this.request("/workspaces");
  }

  async getPipeline(workspaceId: string, pipelineId: string): Promise<FabricItem> {
    return this.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(pipelineId)}`,
    );
  }

  async getPipelineRun(
    workspaceId: string,
    pipelineId: string,
    jobInstanceId: string,
  ): Promise<FabricJobInstance> {
    return this.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(pipelineId)}/jobs/instances/${encodeURIComponent(jobInstanceId)}`,
    );
  }

  /** Fabric's public API doesn't expose a dedicated log-streaming endpoint the way, say,
   *  a CI system does — the job instance's own status/failureReason is the closest real
   *  signal available, so that's what this surfaces rather than fabricating log lines. */
  async getLogs(workspaceId: string, pipelineId: string, jobInstanceId: string): Promise<FabricJobInstance> {
    return this.getPipelineRun(workspaceId, pipelineId, jobInstanceId);
  }

  /** Starts a new pipeline run via the Job Scheduler API — this is what "retry" means for
   *  Fabric (there's no "rerun this exact failed instance" endpoint publicly documented;
   *  it's a fresh run of the same pipeline item). Returns the new job instance id from the
   *  Location header Fabric's async job-creation returns (202 Accepted). */
  async retryPipeline(workspaceId: string, pipelineId: string): Promise<{ jobInstanceId: string | null }> {
    const res = await fetch(
      `${FABRIC_API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(pipelineId)}/jobs/instances?jobType=Pipeline`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FabricApiError(`Fabric retry-pipeline returned ${res.status}: ${body.slice(0, 500)}`, res.status);
    }
    const location = res.headers.get("location");
    const jobInstanceId = location ? location.split("/").pop() ?? null : null;
    return { jobInstanceId };
  }
}
