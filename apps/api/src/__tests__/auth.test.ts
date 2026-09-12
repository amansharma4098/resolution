import { describe, expect, it } from "vitest";
import { buildTestApp, cookieFrom, jsonOf, req, signupWithOrg } from "./test-helpers";

describe("auth", () => {
  it("self-serve signup never sets mustChangePassword", async () => {
    const { app } = buildTestApp();
    const signup = await req(app, "/api/auth/signup", {
      method: "POST",
      body: { email: "self-serve@example.com", password: "correct horse battery staple" },
    });
    expect((await jsonOf(signup)).user.mustChangePassword).toBe(false);
  });

  describe("change-password", () => {
    async function setUpFlaggedUser(app: ReturnType<typeof buildTestApp>["app"]) {
      const { cookie: ownerCookie, organizationId } = await signupWithOrg(app, "owner@example.com", "Acme");
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
      return { cookie: cookieFrom(login), temporaryPassword: temporaryPassword as string };
    }

    it("rejects the wrong current password", async () => {
      const { app } = buildTestApp();
      const { cookie } = await setUpFlaggedUser(app);

      const res = await req(app, "/api/auth/change-password", {
        method: "POST",
        cookie,
        body: { currentPassword: "wrong-password-entirely", newPassword: "a-new-strong-password" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects a new password shorter than the 12-character policy", async () => {
      const { app } = buildTestApp();
      const { cookie, temporaryPassword } = await setUpFlaggedUser(app);

      const res = await req(app, "/api/auth/change-password", {
        method: "POST",
        cookie,
        body: { currentPassword: temporaryPassword, newPassword: "short" },
      });
      expect(res.status).toBe(400);
    });

    it("changes the password and clears mustChangePassword", async () => {
      const { app } = buildTestApp();
      const { cookie, temporaryPassword } = await setUpFlaggedUser(app);

      const res = await req(app, "/api/auth/change-password", {
        method: "POST",
        cookie,
        body: { currentPassword: temporaryPassword, newPassword: "a-new-strong-password" },
      });
      expect(res.status).toBe(200);
      expect((await jsonOf(res)).user.mustChangePassword).toBe(false);

      // Old password no longer works, new one does.
      const oldLogin = await req(app, "/api/auth/login", {
        method: "POST",
        body: { email: "flagged@example.com", password: temporaryPassword },
      });
      expect(oldLogin.status).toBe(401);

      const newLogin = await req(app, "/api/auth/login", {
        method: "POST",
        body: { email: "flagged@example.com", password: "a-new-strong-password" },
      });
      expect(newLogin.status).toBe(200);
    });
  });
});
