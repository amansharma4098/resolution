import { describe, expect, it } from "vitest";
import { RcaClaim, RootCauseAnalysisOutput } from "../rca";

const evidenceId = "550e8400-e29b-41d4-a716-446655440000";

describe("RcaClaim", () => {
  it("accepts a FACT claim with cited evidence", () => {
    const result = RcaClaim.parse({
      text: "The pipeline run failed with error code 500",
      claimType: "FACT",
      evidenceIds: [evidenceId],
      confidence: 0.95,
    });
    expect(result.claimType).toBe("FACT");
  });

  it("rejects a FACT claim with no cited evidence — never invent evidence", () => {
    expect(() =>
      RcaClaim.parse({
        text: "The pipeline run failed",
        claimType: "FACT",
        evidenceIds: [],
        confidence: 0.9,
      }),
    ).toThrow(/must cite at least one evidenceId/);
  });

  it("allows a HYPOTHESIS claim with no cited evidence", () => {
    const result = RcaClaim.parse({
      text: "This may be related to a recent config change",
      claimType: "HYPOTHESIS",
      confidence: 0.4,
    });
    expect(result.evidenceIds).toEqual([]);
  });

  it("rejects a confidence outside [0,1]", () => {
    expect(() =>
      RcaClaim.parse({
        text: "x",
        claimType: "INFERENCE",
        confidence: 1.5,
      }),
    ).toThrow();
  });
});

describe("RootCauseAnalysisOutput", () => {
  it("requires at least one claim", () => {
    expect(() =>
      RootCauseAnalysisOutput.parse({ summary: "No root cause found", claims: [], confidence: 0 }),
    ).toThrow();
  });
});
