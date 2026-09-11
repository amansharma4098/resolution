import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FabricApiError, FabricClient, getFabricAccessToken } from "../client";

describe("getFabricAccessToken", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests a token from the correct Azure AD v2.0 endpoint with client-credentials grant", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "tok_abc" }), { status: 200 }));
    const token = await getFabricAccessToken({ tenantId: "t1", clientId: "c1", clientSecret: "s1" });

    expect(token).toBe("tok_abc");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("c1");
    expect(body.get("client_secret")).toBe("s1");
    expect(body.get("scope")).toBe("https://api.fabric.microsoft.com/.default");
  });

  it("throws FabricApiError on a failed token request", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_client", { status: 401 }));
    await expect(getFabricAccessToken({ tenantId: "t1", clientId: "c1", clientSecret: "wrong" })).rejects.toThrow(
      FabricApiError,
    );
  });
});

describe("FabricClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends a Bearer token and requests the correct workspace URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "ws1", displayName: "My Workspace", type: "Workspace" }), { status: 200 }),
    );
    const client = new FabricClient("tok_xyz");
    const ws = await client.getWorkspace("ws1");

    expect(ws.displayName).toBe("My Workspace");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.fabric.microsoft.com/v1/workspaces/ws1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_xyz");
  });

  it("throws FabricApiError with the status code on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const client = new FabricClient("tok_xyz");
    await expect(client.getWorkspace("ws1")).rejects.toMatchObject({ status: 403 });
  });

  it("getLogs surfaces the job instance's status/failureReason (no dedicated log API)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "job1",
          itemId: "pipe1",
          jobType: "Pipeline",
          status: "Failed",
          failureReason: { errorCode: "Timeout", message: "Activity timed out after 30m" },
        }),
        { status: 200 },
      ),
    );
    const client = new FabricClient("tok_xyz");
    const run = await client.getLogs("ws1", "pipe1", "job1");
    expect(run.status).toBe("Failed");
    expect(run.failureReason?.errorCode).toBe("Timeout");
  });

  it("retryPipeline extracts the new job instance id from the Location header", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { Location: "https://api.fabric.microsoft.com/v1/workspaces/ws1/items/pipe1/jobs/instances/job2" },
      }),
    );
    const client = new FabricClient("tok_xyz");
    const result = await client.retryPipeline("ws1", "pipe1");
    expect(result.jobInstanceId).toBe("job2");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.fabric.microsoft.com/v1/workspaces/ws1/items/pipe1/jobs/instances?jobType=Pipeline");
    expect(init.method).toBe("POST");
  });
});
