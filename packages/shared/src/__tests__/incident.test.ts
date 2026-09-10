import { describe, expect, it } from "vitest";
import { NormalizedIncident } from "../incident";

const base = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  organizationId: "550e8400-e29b-41d4-a716-446655440001",
  externalId: "JIRA-123",
  source: "JIRA" as const,
  title: "Pipeline failing",
  description: "The nightly ETL pipeline is failing",
  severity: "HIGH" as const,
  priority: "P2" as const,
  status: "NEW" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("NormalizedIncident", () => {
  it("accepts a minimal valid incident and defaults metadata to {}", () => {
    const result = NormalizedIncident.parse(base);
    expect(result.metadata).toEqual({});
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("rejects an invalid source", () => {
    expect(() => NormalizedIncident.parse({ ...base, source: "EMAIL" })).toThrow();
  });

  it("rejects a missing title", () => {
    expect(() => NormalizedIncident.parse({ ...base, title: "" })).toThrow();
  });

  it("accepts the optional affectedSystem field", () => {
    const result = NormalizedIncident.parse({ ...base, affectedSystem: "FABRIC" });
    expect(result.affectedSystem).toBe("FABRIC");
  });
});
