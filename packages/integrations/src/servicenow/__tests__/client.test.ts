import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceNowApiError, ServiceNowClient } from "../client";

describe("ServiceNowClient", () => {
  const credential = { username: "integration.user", password: "s3cret" };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends HTTP Basic auth built from username:password", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: [] }), { status: 200 }));
    const client = new ServiceNowClient("https://acme.service-now.com", credential);
    await client.testConnection();

    const [, init] = fetchMock.mock.calls[0]!;
    const authHeader = (init.headers as Record<string, string>).Authorization;
    expect(authHeader).toBe(`Basic ${btoa("integration.user:s3cret")}`);
  });

  it("requests the correct incident URL", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: {} }), { status: 200 }));
    const client = new ServiceNowClient("https://acme.service-now.com/", credential);
    await client.getIncident("abc123");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://acme.service-now.com/api/now/table/incident/abc123",
    );
  });

  it("throws ServiceNowApiError with the status code on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const client = new ServiceNowClient("https://acme.service-now.com", credential);
    await expect(client.testConnection()).rejects.toThrow(ServiceNowApiError);
    await expect(client.testConnection()).rejects.toMatchObject({ status: 401 });
  });

  it("PATCHes a work note", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: {} }), { status: 200 }));
    const client = new ServiceNowClient("https://acme.service-now.com", credential);
    await client.addWorkNote("abc123", "Auto-resolved by the AI agent");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ work_notes: "Auto-resolved by the AI agent" });
  });
});
