const API_VERSION = "2019-03-01";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AzureAlert {
  id: string;
  name: string;
  properties: {
    essentials: {
      severity: string;
      monitorCondition: string;
      alertState: string;
      alertRule: string;
      description?: string;
      targetResource?: string;
      startDateTime?: string;
      lastModifiedDateTime?: string;
    };
  };
}

export class AzureMonitorClient {
  private token?: string;
  constructor(
    private readonly subscriptionId: string,
    private readonly credential: Record<string, unknown>,
  ) {
    for (const value of [subscriptionId, credential.tenantId, credential.clientId]) {
      if (typeof value !== "string" || !GUID.test(value))
        throw new Error("Azure subscription, directory tenant and client IDs must be UUIDs");
    }
    if (!credential.clientSecret)
      throw new Error("Azure service principal client secret is required");
  }
  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await fetch(
      `https://login.microsoftonline.com/${this.credential.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: String(this.credential.clientId),
          client_secret: String(this.credential.clientSecret),
          scope: "https://management.azure.com/.default",
        }),
      },
    );
    if (!response.ok) throw new Error(`Azure authentication failed (${response.status})`);
    const result = (await response.json()) as { access_token?: string };
    if (!result.access_token) throw new Error("Azure returned no access token");
    this.token = result.access_token;
    return this.token;
  }
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const parsed = new URL(url);
    const prefix = `/subscriptions/${this.subscriptionId}/`;
    if (
      parsed.origin !== "https://management.azure.com" ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.toLowerCase().startsWith(prefix.toLowerCase())
    )
      throw new Error("Invalid Azure subscription endpoint");
    const response = await fetch(parsed, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) throw new Error(`Azure Monitor request failed (${response.status})`);
    return (await response.json()) as T;
  }
  async listAlerts(cursor?: string): Promise<{ value: AzureAlert[]; nextLink?: string }> {
    const root = `https://management.azure.com/subscriptions/${this.subscriptionId}/providers/Microsoft.AlertsManagement/alerts`;
    if (cursor && new URL(cursor).pathname.toLowerCase() !== new URL(root).pathname.toLowerCase())
      throw new Error("Invalid Azure pagination endpoint");
    return this.request(
      cursor ??
        `${root}?api-version=${API_VERSION}&monitorCondition=Fired&timeRange=30d&pageCount=100&sortBy=startDateTime&sortOrder=asc`,
    );
  }
  private alertUrl(id: string): string {
    if (
      !/^\/subscriptions\/[a-f0-9-]+\/(?:[a-z0-9_.-]+\/)*providers\/microsoft\.alertsmanagement\/alerts\/[a-f0-9-]+$/i.test(
        id,
      )
    )
      throw new Error("Invalid Azure alert resource ID");
    return `https://management.azure.com${id}`;
  }
  getAlert(id: string): Promise<AzureAlert> {
    return this.request(`${this.alertUrl(id)}?api-version=${API_VERSION}`);
  }
  async closeAlert(id: string, comments: string): Promise<void> {
    const current = await this.getAlert(id);
    if (current.properties.essentials.monitorCondition !== "Resolved")
      throw new Error(
        "Azure still reports the alert condition as Fired; closure will retry after recovery",
      );
    if (current.properties.essentials.alertState === "Closed") return;
    await this.request(
      `${this.alertUrl(id)}/changestate?api-version=${API_VERSION}&newState=Closed`,
      {
        method: "POST",
        body: JSON.stringify({ comments }),
      },
    );
    if ((await this.getAlert(id)).properties.essentials.alertState !== "Closed")
      throw new Error("Azure alert closure has not been confirmed");
  }
}
