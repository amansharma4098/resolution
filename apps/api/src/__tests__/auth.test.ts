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
      const { cookie: ownerCookie, tenantId } = await signupWithOrg(app, "owner@example.com", "Acme");
      const added = await req(app, "/api/organizations/members", {
        method: "POST",
        cookie: ownerCookie,
        tenantId,
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

  describe("forgot-password / reset-password", () => {
    function extractToken(text: string): string {
      const match = /token=([0-9a-f]+)/.exec(text);
      if (!match) throw new Error(`test setup: no reset token found in email body: ${text}`);
      return match[1]!;
    }

    it("emails a reset link for a registered email, and resetting with it changes the password", async () => {
      const { app, emailSender } = buildTestApp();
      await req(app, "/api/auth/signup", {
        method: "POST",
        body: { email: "reset-me@example.com", password: "correct horse battery staple" },
      });

      const forgot = await req(app, "/api/auth/forgot-password", {
        method: "POST",
        body: { email: "reset-me@example.com" },
      });
      expect(forgot.status).toBe(200);
      expect(emailSender.sent).toHaveLength(1);
      expect(emailSender.sent[0]!.to).toBe("reset-me@example.com");

      const token = extractToken(emailSender.sent[0]!.text);
      const reset = await req(app, "/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "a-brand-new-strong-password" },
      });
      expect(reset.status).toBe(204);

      const oldLogin = await req(app, "/api/auth/login", {
        method: "POST",
        body: { email: "reset-me@example.com", password: "correct horse battery staple" },
      });
      expect(oldLogin.status).toBe(401);

      const newLogin = await req(app, "/api/auth/login", {
        method: "POST",
        body: { email: "reset-me@example.com", password: "a-brand-new-strong-password" },
      });
      expect(newLogin.status).toBe(200);
    });

    it("responds identically for an unregistered email, and sends no email — no enumeration oracle", async () => {
      const { app, emailSender } = buildTestApp();
      const res = await req(app, "/api/auth/forgot-password", {
        method: "POST",
        body: { email: "nobody@example.com" },
      });
      expect(res.status).toBe(200);
      expect(emailSender.sent).toHaveLength(0);
    });

    it("rejects a reset token that's already been used once", async () => {
      const { app, emailSender } = buildTestApp();
      await req(app, "/api/auth/signup", {
        method: "POST",
        body: { email: "reuse@example.com", password: "correct horse battery staple" },
      });
      await req(app, "/api/auth/forgot-password", { method: "POST", body: { email: "reuse@example.com" } });
      const token = extractToken(emailSender.sent[0]!.text);

      const first = await req(app, "/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "first-new-strong-password" },
      });
      expect(first.status).toBe(204);

      const second = await req(app, "/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "second-new-strong-password" },
      });
      expect(second.status).toBe(401);
    });

    it("rejects an invalid/garbage token", async () => {
      const { app } = buildTestApp();
      const res = await req(app, "/api/auth/reset-password", {
        method: "POST",
        body: { token: "not-a-real-token", newPassword: "a-brand-new-strong-password" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects a new password shorter than the 12-character policy", async () => {
      const { app, emailSender } = buildTestApp();
      await req(app, "/api/auth/signup", {
        method: "POST",
        body: { email: "weak-reset@example.com", password: "correct horse battery staple" },
      });
      await req(app, "/api/auth/forgot-password", {
        method: "POST",
        body: { email: "weak-reset@example.com" },
      });
      const token = extractToken(emailSender.sent[0]!.text);

      const res = await req(app, "/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: "short" },
      });
      expect(res.status).toBe(400);
    });
  });
});
