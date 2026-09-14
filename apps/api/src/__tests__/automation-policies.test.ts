import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("automation policy routes", () => {
  let app: Hono<AppEnv>;
  let cookie: string;
  let tenantId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("starts empty — every capability falls back to the policy engine's own default", async () => {
    const res = await req(app, "/api/automation-policies", { cookie, tenantId });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).policies).toEqual([]);
  });

  it("an admin can create a policy for a (mapServerType, capabilityKey)", async () => {
    const res = await req(app, "/api/automation-policies", {
      method: "PUT",
      cookie,
      tenantId,
      body: {
        mapServerType: "FABRIC",
        capabilityKey: "retry_pipeline",
        riskLevel: "LOW",
        behavior: "AUTO",
        resolutionModeFloor: "AUTONOMOUS",
      },
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.policy).toMatchObject({
      mapServerType: "FABRIC",
      capabilityKey: "retry_pipeline",
      behavior: "AUTO",
      resolutionModeFloor: "AUTONOMOUS",
    });

    const list = await req(app, "/api/automation-policies", { cookie, tenantId });
    expect((await jsonOf(list)).policies).toHaveLength(1);
  });

  it("upserts in place rather than creating a duplicate for the same capability", async () => {
    const body = {
      mapServerType: "FABRIC" as const,
      capabilityKey: "retry_pipeline",
      riskLevel: "LOW" as const,
      behavior: "AUTO" as const,
      resolutionModeFloor: "AUTONOMOUS" as const,
    };
    await req(app, "/api/automation-policies", { method: "PUT", cookie, tenantId, body });
    const second = await req(app, "/api/automation-policies", {
      method: "PUT",
      cookie,
      tenantId,
      body: { ...body, behavior: "DENY" },
    });
    expect((await jsonOf(second)).policy.behavior).toBe("DENY");

    const list = await req(app, "/api/automation-policies", { cookie, tenantId });
    expect((await jsonOf(list)).policies).toHaveLength(1);
  });

  it("a non-admin (MEMBER) cannot create a policy", async () => {
    const memberEmail = "member@example.com";
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie,
      tenantId,
      body: { email: memberEmail, role: "MEMBER" },
    });
    const { temporaryPassword } = await jsonOf(added);

    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: memberEmail, password: temporaryPassword },
    });
    const memberCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const res = await req(app, "/api/automation-policies", {
      method: "PUT",
      cookie: memberCookie,
      tenantId,
      body: {
        mapServerType: "FABRIC",
        capabilityKey: "retry_pipeline",
        riskLevel: "LOW",
        behavior: "AUTO",
        resolutionModeFloor: "AUTONOMOUS",
      },
    });
    expect(res.status).toBe(403);
  });

  it("deletes a policy", async () => {
    const created = await req(app, "/api/automation-policies", {
      method: "PUT",
      cookie,
      tenantId,
      body: {
        mapServerType: "FABRIC",
        capabilityKey: "retry_pipeline",
        riskLevel: "LOW",
        behavior: "AUTO",
        resolutionModeFloor: "AUTONOMOUS",
      },
    });
    const id = (await jsonOf(created)).policy.id;

    const del = await req(app, `/api/automation-policies/${id}`, { method: "DELETE", cookie, tenantId });
    expect(del.status).toBe(204);

    const list = await req(app, "/api/automation-policies", { cookie, tenantId });
    expect((await jsonOf(list)).policies).toHaveLength(0);
  });

  it("404s deleting a policy that doesn't exist", async () => {
    const res = await req(app, "/api/automation-policies/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      cookie,
      tenantId,
    });
    expect(res.status).toBe(404);
  });
});
