/**
 * D1/SQLite has no native JSON column type (unlike Postgres, which the schema originally
 * targeted) — every field that used to be Prisma's `Json` type is now a plain `String`
 * storing JSON text, and every repository that touches one of these fields must
 * explicitly serialize on write and parse on read. This file is that one place, so the
 * pattern (and its failure mode) is consistent everywhere instead of ad-hoc per repository.
 */
export function serializeJsonField(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/** Parses a stored JSON-text column back to a value. Falls back to `fallback` (never
 *  throws) on malformed stored data — a row should never make an entire API response
 *  fail because one JSON column got corrupted upstream. */
export function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
