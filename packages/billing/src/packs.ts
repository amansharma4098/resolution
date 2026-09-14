/**
 * Pricing. One credit = one cent of real cost (LLM tokens, remediation execution) — kept as
 * a 1:1 mapping rather than an arbitrary internal unit so a balance is always legible
 * without a conversion table.
 *
 * Two ways to get credits, two different rates, on explicit direction:
 * - **Auto-recharge** (pay-as-you-go top-ups charged to a saved card as the wallet runs
 *   low): the baseline rate, `BASELINE_CENTS_PER_CREDIT`.
 * - **One-time purchase** (a fixed pack, paid upfront via Stripe Checkout): 20% off that
 *   baseline — the incentive for committing to a bundle instead of metering.
 */
export const BASELINE_CENTS_PER_CREDIT = 2; // $0.02/credit — the auto-recharge rate
export const ONE_TIME_PURCHASE_DISCOUNT = 0.2; // 20% off baseline for a one-time pack

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  /** What this pack actually costs, in cents — already discounted. */
  priceCents: number;
  /** What the same number of credits would cost at the baseline (undiscounted) rate, in
   *  cents — shown crossed out next to `priceCents` so the discount is visible, not just
   *  asserted. */
  baselinePriceCents: number;
}

function pack(id: string, name: string, credits: number): CreditPack {
  const baselinePriceCents = credits * BASELINE_CENTS_PER_CREDIT;
  const priceCents = Math.round(baselinePriceCents * (1 - ONE_TIME_PURCHASE_DISCOUNT));
  return { id, name, credits, priceCents, baselinePriceCents };
}

export const CREDIT_PACKS: CreditPack[] = [
  pack("starter", "Starter", 5_000), // $80 (vs $100 baseline)
  pack("growth", "Growth", 20_000), // $320 (vs $400 baseline)
  pack("scale", "Scale", 100_000), // $1,600 (vs $2,000 baseline)
];

export function findCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}
