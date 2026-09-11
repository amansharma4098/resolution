-- Adds the platform-level Super Admin flag to User (see schema.prisma's comment on it).
-- Hand-written rather than generated via `prisma migrate diff` — this is a genuinely
-- incremental change against already-applied production data (10 real tenants at the time
-- this was written), and D1/SQLite's ADD COLUMN with a DEFAULT is a safe, single-statement
-- operation that doesn't need the diff tool's from-empty machinery.
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
