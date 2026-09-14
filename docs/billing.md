# Billing & Credits

Self-serve, usage-based credits — the piece that turns the (already-real) self-serve signup
flow from free into something that can actually charge someone. One credit = one cent of
real cost (LLM tokens, remediation execution); kept 1:1 rather than an arbitrary unit so a
balance is always legible.

## Two rates, on purpose

- **One-time purchase** (`packages/billing/src/packs.ts`'s `CREDIT_PACKS`, bought via Stripe
  Checkout): **20% off** the baseline rate — the incentive for committing to a bundle
  upfront instead of metering.
- **Auto-recharge** (pay-as-you-go top-ups charged to a saved card as the wallet runs low):
  the baseline rate, `BASELINE_CENTS_PER_CREDIT` ($0.02/credit). **Not built yet** — the
  `CreditWallet` schema has the fields (`autoRechargeEnabled`,
  `autoRechargeThresholdCredits`, `autoRechargeAmountCredits`,
  `stripePaymentMethodId`) for it, but nothing charges a saved card off-session today; only
  the one-time-purchase path is real.

| Pack | Credits | Price | vs. baseline |
|---|---|---|---|
| Starter | 5,000 | $80 | $100 |
| Growth | 20,000 | $320 | $400 |
| Scale | 100,000 | $1,600 | $2,000 |

## Data model

`CreditWallet` (one per tenant, created lazily on first touch) and `CreditTransaction` (an
append-only ledger — every balance change is one row, never a silent mutation).
`CreditTransactionType`: `PURCHASE | CONSUMPTION | REFUND | BONUS | TRIAL_GRANT`. `amount`
is always a positive magnitude; `type` says which direction it moved the balance
(`CreditWalletRepository.applyTransaction` is the only place that interprets it either way).

## Purchase flow

1. `POST /api/billing/checkout` (Owner-only — matches the nav split: managing money is an
   Owner power, distinct from an Admin's org-configuration powers) creates a real Stripe
   Checkout Session for the chosen pack and returns its URL to redirect to.
2. Stripe redirects back to `/dashboard/billing?checkout=success` (or `canceled`) —
   informational only; the balance itself is never trusted from a client-side redirect.
3. `POST /api/webhooks/stripe` — real signature verification (`Stripe-Signature` header,
   HMAC-SHA256, `packages/billing/src/stripe-client.ts`'s `verifyStripeSignature`), unlike
   every other webhook source in this codebase, which relies on a shared secret because the
   source system doesn't sign its own requests. On `checkout.session.completed` with
   `payment_status: "paid"`, credits the tenant found in the session's own `metadata`
   (set by this platform at checkout-session creation, never client-supplied) and stores the
   Stripe Customer id for reuse on the next purchase. Idempotent on the Checkout Session id
   (`CreditTransaction.stripeCheckoutSessionId` is unique) — a redelivered webhook event
   never double-credits.

## MOCK_MODE-style fallback

No `STRIPE_SECRET_KEY` configured means `POST /api/billing/checkout` applies the purchase
directly server-side instead of creating a real Checkout Session — labeled `mock: true` in
the response, same disclosed, zero-cost-by-default treatment as every other real-provider
integration in this codebase (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`). Lets the full
purchase → wallet → (eventually) consumption loop be exercised with zero external accounts.

## Not yet built

- **Auto-recharge** — an off-session charge (Stripe `SetupIntent` + a later off-session
  `PaymentIntent`) when the balance crosses `autoRechargeThresholdCredits`.
- **Real consumption debiting** — nothing calls `CreditWalletRepository.applyTransaction`
  with `type: "CONSUMPTION"` yet. The real per-call token counts are already on the
  Anthropic API response `packages/ai`'s client receives, just not yet surfaced through
  `LlmTurnResult` (currently `stopReason`/`content`/`toolUses` only) — plumbing that through
  and calling `applyTransaction` from the investigation/remediation queue consumers, plus a
  per-remediation-execution charge, is the natural next step this ledger was built for.
- **Low-balance handling** — pausing new investigations and alerting the Owner as the
  balance approaches zero, per the product spec.
