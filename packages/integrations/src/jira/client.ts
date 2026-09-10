/**
 * A thin wrapper over the real Jira Cloud REST API v3 — no SDK, just typed fetch calls.
 * Auth is HTTP Basic with an Atlassian API token (email + token), which is what Jira Cloud
 * actually expects for server-to-server calls; OAuth 2.0 (3LO) would need an app registered
 * in the Atlassian developer console with a callback URL, which is a customer-side setup
 * step this package doesn't assume. `authenticationType: BASIC_AUTH` in the Credential
 * payload maps `username` -> email, `password` -> API token.
 *
 * This has not been exercised against a live Jira tenant in this environment (no test Jira
 * account was available) — the API calls, auth header, and payload shapes match Atlassian's
 * published REST API v3 docs exactly, but say so plainly rather than claiming it's been
 * integration-tested against the real service.
 */
export interface JiraCredential {
  email: string;
  apiToken: string;
}

export interface JiraIssueRef {
  id: string;
  key: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: unknown; // Atlassian Document Format (ADF) — rich text, not plain string
    status: { name: string };
    priority?: { name: string } | null;
    project: { key: string; name: string };
    created: string;
    updated: string;
  };
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export class JiraClient {
  constructor(
    private readonly baseUrl: string, // e.g. "https://your-domain.atlassian.net"
    private readonly credential: JiraCredential,
  ) {}

  private authHeader(): string {
    const encoded = btoa(`${this.credential.email}:${this.credential.apiToken}`);
    return `Basic ${encoded}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
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
      throw new JiraApiError(`Jira API ${path} returned ${res.status}: ${body.slice(0, 500)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Real connectivity test — GET /myself succeeds only with a genuinely valid credential
   *  against a genuinely reachable Jira instance. */
  async getMyself(): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
    return this.request("/rest/api/3/myself");
  }

  async getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}`);
  }

  /** Plain-text comment, wrapped in the minimal Atlassian Document Format Jira Cloud
   *  requires for the comment body. */
  async addComment(issueIdOrKey: string, text: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      }),
    });
  }

  async listTransitions(issueIdOrKey: string): Promise<{ id: string; name: string }[]> {
    const res = await this.request<{ transitions: { id: string; name: string }[] }>(
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
    );
    return res.transitions;
  }

  async transitionIssue(issueIdOrKey: string, transitionId: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }
}
