import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. In dev, Next.js/tsx hot-reload can otherwise spawn a new
// PrismaClient (and a new connection pool) on every file change — cache it on `globalThis`.
declare global {
  // eslint-disable-next-line no-var
  var __resolutionPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__resolutionPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__resolutionPrisma = prisma;
}
