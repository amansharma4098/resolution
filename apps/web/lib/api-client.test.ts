import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hosted API requests", () => {
  it("sends signup to the same origin when no API override was set at build time", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ user: { id: "user1" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const { apiRequest } = await import("./api-client");
    await apiRequest("/api/auth/signup", {
      method: "POST",
      body: { email: "test@example.com", password: "test-only-password" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
  it("honors an explicitly configured local API during development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8787");
    const fetch = vi.fn().mockResolvedValue(Response.json({ organizations: [] }));
    vi.stubGlobal("fetch", fetch);
    const { apiRequest } = await import("./api-client");
    await apiRequest("/api/organizations");
    expect(fetch.mock.calls[0]![0]).toBe("http://localhost:8787/api/organizations");
  });
  it("gives a useful error when the network cannot reach the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { apiRequest } = await import("./api-client");
    await expect(apiRequest("/api/auth/signup")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
  it("rejects a successful HTML response instead of pretending it is valid API data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Unexpected page</html>")));
    const { apiRequest } = await import("./api-client");
    await expect(apiRequest("/api/organizations")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
