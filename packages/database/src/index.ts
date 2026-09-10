// No Node-process Prisma singleton is exported here on purpose: this barrel is imported by
// apps/api's Worker bundle, and a plain (non-adapter) `new PrismaClient()` throws the
// instant it's *constructed* — even if never called — because the Workers runtime can't
// run Prisma's native/WASM query engine without a driver adapter. `createD1Client` is the
// only Prisma constructor path this package exposes; scripts that need a local Node client
// against a `file:` sqlite URL (e.g. ad-hoc queries) should `new PrismaClient()` directly
// rather than share a module-level singleton from here.
export { createD1Client } from "./d1-client";
export { TenantScopedRepository } from "./tenant-scoped-repository";
export * from "./repositories/user-repository";
export * from "./repositories/organization-repository";
export * from "./repositories/credential-repository";
export * from "./repositories/map-server-repository";
export * from "./repositories/integration-repository";
export * from "./repositories/incident-repository";
export * from "./audit-log-writer";
export * from "./json-field";
// Deliberately not `export * from "@prisma/client"` — its generated model types (Credential,
// Integration, MapServer, ...) collide with the parsed/narrowed public shapes each
// repository defines above (D1/SQLite has no native JSON or enum type, so the raw Prisma
// row shape isn't what callers should use — see each repository's `toPublic` mapper).
export type { PrismaClient, Prisma } from "@prisma/client";
