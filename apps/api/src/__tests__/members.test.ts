import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { buildTestApp, cookieFrom, jsonOf, req, signupWithOrg } from "./test-helpers";
import type { AppEnv } from "../types";

describe("organization member management", () => {
  let app: Hono<AppEnv>;
  let ownerCookie: string;
  let organizationId: string;

  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ cookie: ownerCookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme"));
  });

  it("the org creator is listed as OWNER", async () => {
    const res = await req(app, "/api/organizations/members", { cookie: ownerCookie, organizationId });
    const body = await jsonOf(res);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({ email: "owner@example.com", role: "OWNER" });
  });

  it("an admin can add a brand-new local user and gets a one-time temporary password", async () => {
    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "newhire@example.com", name: "New Hire", role: "MEMBER" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.member).toMatchObject({ email: "newhire@example.com", role: "MEMBER" });
    expect(typeof body.temporaryPassword).toBe("string");
    expect(body.temporaryPassword.length).toBeGreaterThan(20);

    // The new local user can actually log in with that temporary password.
    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "newhire@example.com", password: body.temporaryPassword },
    });
    expect(login.status).toBe(200);
  });

  it("a new local user is created with mustChangePassword set", async () => {
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "flagged@example.com", role: "MEMBER" },
    });
    const { temporaryPassword } = await jsonOf(added);

    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "flagged@example.com", password: temporaryPassword },
    });
    const cookie = cookieFrom(login);
    const me = await req(app, "/api/auth/me", { cookie });
    expect((await jsonOf(me)).user.mustChangePassword).toBe(true);
  });

  it("an admin can set a brand-new member's initial password directly instead of generating one", async () => {
    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "chosen@example.com", role: "MEMBER", password: "a-chosen-password-123" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    // The admin already knows the password they typed — nothing new to hand back.
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.newAccount).toBe(true);

    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "chosen@example.com", password: "a-chosen-password-123" },
    });
    expect(login.status).toBe(200);
  });

  it("rejects an admin-supplied password shorter than the 12-character policy", async () => {
    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "short@example.com", role: "MEMBER", password: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("adding an existing user to the org does not return a temporary password (no new account created)", async () => {
    const other = await signupWithOrg(app, "existing@example.com", "Other Org");
    void other;

    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "existing@example.com", role: "VIEWER" },
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.newAccount).toBe(false);
  });

  it("rejects adding the same user twice", async () => {
    await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "dup@example.com", role: "MEMBER" },
    });
    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "dup@example.com", role: "MEMBER" },
    });
    expect(res.status).toBe(409);
  });

  it("a non-admin cannot add members", async () => {
    // Add a MEMBER-role user, then have them try to add someone else.
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "member1@example.com", role: "MEMBER" },
    });
    const { temporaryPassword } = await jsonOf(added);

    const login = await req(app, "/api/auth/login", {
      method: "POST",
      body: { email: "member1@example.com", password: temporaryPassword },
    });
    const memberCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const res = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: memberCookie,
      organizationId,
      body: { email: "someone@example.com", role: "MEMBER" },
    });
    expect(res.status).toBe(403);
  });

  it("changes a member's role", async () => {
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "promote@example.com", role: "MEMBER" },
    });
    const { member } = await jsonOf(added);

    const res = await req(app, `/api/organizations/members/${member.userId}`, {
      method: "PATCH",
      cookie: ownerCookie,
      organizationId,
      body: { role: "ADMIN" },
    });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).member.role).toBe("ADMIN");
  });

  it("refuses to demote the last remaining OWNER", async () => {
    const meRes = await req(app, "/api/auth/me", { cookie: ownerCookie });
    const { user } = await jsonOf(meRes);

    const res = await req(app, `/api/organizations/members/${user.id}`, {
      method: "PATCH",
      cookie: ownerCookie,
      organizationId,
      body: { role: "ADMIN" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses to remove the last remaining OWNER", async () => {
    const meRes = await req(app, "/api/auth/me", { cookie: ownerCookie });
    const { user } = await jsonOf(meRes);

    const res = await req(app, `/api/organizations/members/${user.id}`, {
      method: "DELETE",
      cookie: ownerCookie,
      organizationId,
    });
    expect(res.status).toBe(400);
  });

  it("removes a non-owner member", async () => {
    const added = await req(app, "/api/organizations/members", {
      method: "POST",
      cookie: ownerCookie,
      organizationId,
      body: { email: "toremove@example.com", role: "MEMBER" },
    });
    const { member } = await jsonOf(added);

    const del = await req(app, `/api/organizations/members/${member.userId}`, {
      method: "DELETE",
      cookie: ownerCookie,
      organizationId,
    });
    expect(del.status).toBe(204);

    const list = await req(app, "/api/organizations/members", { cookie: ownerCookie, organizationId });
    expect((await jsonOf(list)).members).toHaveLength(1);
  });
});
