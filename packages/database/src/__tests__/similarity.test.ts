import { describe, expect, it } from "vitest";
import { rankSimilarIncidents, scoreSimilarity } from "../similarity";

const base = { title: "Disk usage above 95% on payments-api", service: "payments-api", affectedSystem: "DATADOG", source: "DATADOG" };

describe("scoreSimilarity", () => {
  it("scores same service, same source, and shared title keywords", () => {
    const { score, matchedOn } = scoreSimilarity(base, {
      title: "Disk usage critical on payments-api",
      service: "payments-api",
      affectedSystem: "DATADOG",
      source: "DATADOG",
    });
    expect(score).toBeGreaterThan(0);
    expect(matchedOn).toContain("service");
    expect(matchedOn).toContain("affectedSystem");
    expect(matchedOn).toContain("source");
    expect(matchedOn).toContain("keyword:disk");
  });

  it("scores 0 for two incidents with nothing in common", () => {
    const { score, matchedOn } = scoreSimilarity(base, {
      title: "Login page returns 500",
      service: "auth-service",
      affectedSystem: "JIRA",
      source: "JIRA",
    });
    expect(score).toBe(0);
    expect(matchedOn).toEqual([]);
  });

  it("does not match on service/affectedSystem when either side is null", () => {
    const { score, matchedOn } = scoreSimilarity(base, {
      title: "Totally unrelated wording here",
      service: null,
      affectedSystem: null,
      source: "DATADOG",
    });
    expect(matchedOn).not.toContain("service");
    expect(matchedOn).not.toContain("affectedSystem");
    expect(matchedOn).toContain("source");
    expect(score).toBe(1);
  });

  it("ignores stopwords and short tokens when comparing titles", () => {
    const { matchedOn } = scoreSimilarity(
      { title: "The disk is at 95%", service: null, affectedSystem: null, source: "WEBHOOK" },
      { title: "A disk was near capacity", service: null, affectedSystem: null, source: "JIRA" },
    );
    expect(matchedOn).toEqual(["keyword:disk"]);
  });
});

describe("rankSimilarIncidents", () => {
  const candidates = [
    { id: "no-match", title: "Completely unrelated", service: null, affectedSystem: null, source: "JIRA" },
    { id: "weak-match", title: "Disk usage warning", service: null, affectedSystem: null, source: "DATADOG" },
    { id: "strong-match", title: "Disk usage above 95% on payments-api", service: "payments-api", affectedSystem: "DATADOG", source: "DATADOG" },
  ];

  it("ranks the strongest match first and drops zero-score candidates", () => {
    const ranked = rankSimilarIncidents(base, candidates, 5);
    expect(ranked.map((r) => r.incident.id)).toEqual(["strong-match", "weak-match"]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("respects the limit", () => {
    const ranked = rankSimilarIncidents(base, candidates, 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.incident.id).toBe("strong-match");
  });
});
