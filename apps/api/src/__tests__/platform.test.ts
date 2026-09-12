import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { FakeDb } from "./fake-db";
import type { AppEnv } from "../types";

describe("platform routes (Super Admin)", () => {
  let app: Hono<AppEnv>;
  let db: FakeDb;
  let cookie: string;

  beforeEach(async () => {
    ({ app, db } = buildTestApp());
    const signup = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "owner@example.com", password: "correct horse battery staple" },
    });
    cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
  });

  function grantSuperAdmin(email: string) {
    const user = db._debug.users.find((u) => u.email === email);
    if (!user) throw new Error(`test setup: no fake user for ${email}`);
    user.isSuperAdmin = true;
  }

  it("a regular (non-super-admin) user gets 403 from every platform route", async () => {
    const list = await req(app, "/api/platform/tenants", { cookie });
    expect(list.status).toBe(403);

    const create = await req(app, "/api/platform/tenants", {
      method: "POST",
      cookie,
      body: { organizationName: "Acme", adminEmail: "admin@acme.com" },
    });
    expect(create.status).toBe(403);
  });

  it("a super admin can list all tenants across the whole platform", async () => {
    grantSuperAdmin("owner@example.com");
    // Two unrelated orgs, created by two different unrelated users — a super admin sees
    // both; a regular member of neither would see zero via the ordinary /api/organizations.
    await signupWithOrg(app, "alice@example.com", "Alice Org");
    await signupWithOrg(app, "bob@example.com", "Bob Org");

    const res = await req(app, "/api/platform/tenants", { cookie });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const names = body.tenants.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Alice Org", "Bob Org"]));
    for (const t of body.tenants) {
      expect(t).toHaveProperty("memberCount");
      expect(t).toHaveProperty("incidentCount");
    }
  });

  it("a super admin can provision a brand-new tenant with a brand-new admin user, getting a one-time temp password", async () => {
    grantSuperAdmin("owner@example.com");

    const res = await req(app, "/api/platform/tenants", {
      method: "POST",
      cookie,
      body: { organizationName: "New Co", adminEmail: "newadmin@newco.com", adminName: "New Admin" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.organization.name).toBe("New Co");
    expect(body.admin.email).toBe("newadmin@newco.com");
    expect(body.temporaryPassword).toMatch(/^[0-9a-f]{36}$/);
    expect(body.newAccount).toBe(true);

    // The new admin can actually log in with it and land as OWNER of exactly that org, and
    // is flagged to change the (system-generated) password on first login.
    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "newadmin@newco.com", password: body.temporaryPassword },
    });
    expect(login.status).toBe(200);
    const newAdminCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const orgs = await req(app, "/api/organizations", { cookie: newAdminCookie });
    const orgList = await jsonOf(orgs);
    expect(orgList.organizations).toHaveLength(1);
    expect(orgList.organizations[0]).toMatchObject({ name: "New Co", role: "OWNER" });

    const me = await req(app, "/api/auth/me", { cookie: newAdminCookie });
    expect((await jsonOf(me)).user.mustChangePassword).toBe(true);
  });

  it("a super admin can set the new tenant admin's initial password directly instead of generating one", async () => {
    grantSuperAdmin("owner@example.com");

    const res = await req(app, "/api/platform/tenants", {
      method: "POST",
      cookie,
      body: {
        organizationName: "Chosen Co",
        adminEmail: "chosenadmin@chosenco.com",
        adminPassword: "a-chosen-admin-password",
      },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.newAccount).toBe(true);

    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "chosenadmin@chosenco.com", password: "a-chosen-admin-password" },
    });
    expect(login.status).toBe(200);
  });

  it("provisioning a tenant for an existing user's email adds them as OWNER without a temp password", async () => {
    grantSuperAdmin("owner@example.com");
    await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "existing@example.com", password: "correct horse battery staple" },
    });

    const res = await req(app, "/api/platform/tenants", {
      method: "POST",
      cookie,
      body: { organizationName: "Second Org", adminEmail: "existing@example.com" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.newAccount).toBe(false);
  });

  it("self-serve organization creation (POST /api/organizations) still works — additive, not a replacement", async () => {
    const res = await req(app, "/api/organizations", { method: "POST", cookie, body: { name: "Self Serve Org" } });
    expect(res.status).toBe(201);
  });
});
