import { prisma } from "@resolution/database";
import { buildApp } from "./app";
import { loadEnv } from "./env";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ db: prisma, env });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error starting apps/api:", err);
  process.exit(1);
});
