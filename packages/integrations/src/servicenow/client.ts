/**
 * A thin wrapper over ServiceNow's real Table API — no SDK, just typed fetch calls. Auth is
 * HTTP Basic (a ServiceNow username + password), the simplest and most broadly-supported
 * auth mode for the Table API (OAuth2 is also available but needs an OAuth application
 * registered in the customer's own ServiceNow instance — a customer-side setup step this
 * package doesn't assume, same reasoning as Jira's client). `authenticationType:
 * BASIC_AUTH` in the Credential payload maps directly: `username` -> ServiceNow username,
 * `password` -> ServiceNow password.
 *
 * Not exercised against a live ServiceNow instance in this environment (no test account
 * was available) — the endpoints and payload shapes match ServiceNow's published Table API
 * docs, stated plainly rather than claimed as integration-tested against the real service.
 */
export interface ServiceNowCredential {
  username: string;
  password: string;
}

export interface ServiceNowIncident {
  sys_id: string;
  number: string;
  short_description: string;
  description?: string;
  priority?: string; // e.g. "1 - Critical" .. "5 - Planning"
  state?: string;
  category?: string;
}

export class ServiceNowApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ServiceNowApiError";
  }
}

export class ServiceNowClient {
  constructor(
    private readonly instanceUrl: string, // e.g. "https://your-instance.service-now.com"
    private readonly credential: ServiceNowCredential,
  ) {}

  private authHeader(): string {
    return `Basic ${btoa(`${this.credential.username}:${this.credential.password}`)}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.instanceUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ServiceNowApiError(
        `ServiceNow API ${path} returned ${res.status}: ${body.slice(0, 500)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  /** Real connectivity test — a narrow, harmless read (limit 1) against the incident table
   *  succeeds only with a genuinely valid credential against a genuinely reachable
   *  instance. */
  async testConnection(): Promise<void> {
    await this.request("/api/now/table/incident?sysparm_limit=1");
  }

  async getIncident(sysId: string): Promise<ServiceNowIncident> {
    const res = await this.request<{ result: ServiceNowIncident }>(
      `/api/now/table/incident/${encodeURIComponent(sysId)}`,
    );
    return res.result;
  }

  /** Appends a work note (internal) — ServiceNow's equivalent of a Jira comment that's
   *  visible to agents but not necessarily the end user. */
  async addWorkNote(sysId: string, note: string): Promise<void> {
    await this.request(`/api/now/table/incident/${encodeURIComponent(sysId)}`, {
      method: "PATCH",
      body: JSON.stringify({ work_notes: note }),
    });
  }

  async updateState(sysId: string, state: string): Promise<void> {
    await this.request(`/api/now/table/incident/${encodeURIComponent(sysId)}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
  }
}
