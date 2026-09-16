import { describe, it, expect } from "vitest";
import { loadEnv } from "../env";
import { buildTestApp, jsonOf, req, signupWithOrg } from "./test-helpers";
import { CredentialRepository, type PrismaClient } from "@resolution/database";
import { createEmailSender } from "@resolution/email";

describe("SaaS production safeguards", () => {
  it("rejects production development secrets and silent mock AI", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/dedicated/);
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        JWT_SECRET: "x".repeat(40),
        ENCRYPTION_MASTER_KEY: "x".repeat(44),
        MOCK_MODE: "false",
      }),
    ).toThrow(/ANTHROPIC/);
  });
  it("never issues free credits when production billing is unconfigured", async () => {
    const { app, db } = buildTestApp({ env: { ...loadEnv({}), NODE_ENV: "production" } });
    const owner = await signupWithOrg(app, "billing@example.com", "Acme");
    const res = await req(app, "/api/billing/checkout", {
      ...owner,
      method: "POST",
      body: { packId: "starter" },
    });
    expect(res.status).toBe(503);
    expect(db._debug.creditTransactions).toHaveLength(0);
  });
  it("does not log reset links when production email is missing", async () => {
    await expect(
      createEmailSender({ production: true }).send({
        to: "test@example.com",
        subject: "Reset",
        text: "secret-link",
      }),
    ).rejects.toThrow(/not configured/);
  });
  it("revokes tenant credentials and requires rotation before reuse", async () => {
    const { app, db } = buildTestApp();
    const owner = await signupWithOrg(app, "creds@example.com", "Acme");
    const created = await jsonOf(
      await req(app, "/api/credentials", {
        ...owner,
        method: "POST",
        body: {
          name: "MCP",
          provider: "mcp",
          authenticationType: "TOKEN",
          payload: { token: "original-token" },
        },
      }),
    );
    const id = created.credential.id;
    expect(
      (await req(app, `/api/credentials/${id}/revoke`, { ...owner, method: "POST" })).status,
    ).toBe(200);
    const repo = new CredentialRepository(db as unknown as PrismaClient, owner.tenantId);
    expect(await repo.findUsableById(id)).toBeNull();
    expect(
      (await req(app, `/api/credentials/${id}/test`, { ...owner, method: "POST" })).status,
    ).toBe(400);
    await req(app, `/api/credentials/${id}/rotate`, {
      ...owner,
      method: "POST",
      body: { payload: { token: "replacement-token" } },
    });
    expect(await repo.findUsableById(id)).not.toBeNull();
  });
});
