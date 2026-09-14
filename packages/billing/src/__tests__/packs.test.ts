import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, findCreditPack, BASELINE_CENTS_PER_CREDIT, ONE_TIME_PURCHASE_DISCOUNT } from "../packs";

describe("credit packs", () => {
  it("prices every pack at exactly 20% off the baseline rate", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.baselinePriceCents).toBe(pack.credits * BASELINE_CENTS_PER_CREDIT);
      expect(pack.priceCents).toBe(Math.round(pack.baselinePriceCents * (1 - ONE_TIME_PURCHASE_DISCOUNT)));
      expect(pack.priceCents).toBeLessThan(pack.baselinePriceCents);
    }
  });

  it("findCreditPack finds a real pack by id", () => {
    expect(findCreditPack("starter")?.credits).toBe(5_000);
  });

  it("findCreditPack returns undefined for an unknown id", () => {
    expect(findCreditPack("not-a-real-pack")).toBeUndefined();
  });

  it("every pack has a unique id", () => {
    const ids = CREDIT_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
