import { CreditWalletRepository } from "../repositories/credit-wallet-repository";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

describe("SaaS storage against real SQLite", () => {
  it("applies all migrations, isolates chat queries and atomically claims a conversation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "resolution-saas-"));
    const path = join(directory, "test.db");
    execFileSync("python3", [
      "-c",
      "import sqlite3,pathlib,sys; db=sqlite3.connect(sys.argv[1]); [db.executescript(p.read_text()) for p in sorted(pathlib.Path(sys.argv[2]).glob('*/migration.sql'))]; db.close()",
      path,
      resolve("prisma/migrations"),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
    try {
      const user = await db.user.create({ data: { email: "test@example.com" } });
      const tenant = await db.organization.create({ data: { name: "Tenant", slug: "tenant" } });
      const conversation = await db.chatConversation.create({
        data: { tenantId: tenant.id, userId: user.id, title: "Incident" },
      });
      expect(
        await db.chatConversation.findFirst({
          where: { id: conversation.id, tenantId: "another-tenant", userId: user.id },
        }),
      ).toBeNull();
      expect(
        await db.chatConversation.findFirst({
          where: { id: conversation.id, tenantId: tenant.id, userId: "another-user" },
        }),
      ).toBeNull();
      const claims = await Promise.all(
        [1, 2].map(() =>
          db.chatConversation.updateMany({
            where: {
              id: conversation.id,
              tenantId: tenant.id,
              userId: user.id,
              lockedUntil: { lte: Date.now() },
            },
            data: { lockedUntil: Date.now() + 60000 },
          }),
        ),
      );
      expect(claims.reduce((sum, r) => sum + r.count, 0)).toBe(1);
      const wallet = new CreditWalletRepository(db, tenant.id);
      await wallet.getOrCreate();
      await Promise.all([
        wallet.applyTransaction({ type: "PURCHASE", amount: 10 }),
        wallet.applyTransaction({ type: "PURCHASE", amount: 20 }),
      ]);
      expect((await wallet.get())!.balance).toBe(30);
      expect(await wallet.listTransactions()).toHaveLength(2);
      await expect(wallet.applyTransaction({ type: "CONSUMPTION", amount: 31 })).rejects.toThrow(
        /Insufficient/,
      );
      await db.organization.delete({ where: { id: tenant.id } });
      expect(await db.chatConversation.count()).toBe(0);
    } finally {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
