import { describe, expect, it } from "vitest";
import { slugify } from "../repositories/organization-repository";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Acme & Sons, Inc.")).toBe("acme-sons-inc");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Acme--  ")).toBe("acme");
  });

  it("falls back to a default for an empty/unslugifiable name", () => {
    expect(slugify("***")).toBe("org");
  });
});
