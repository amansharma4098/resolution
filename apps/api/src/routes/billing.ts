import { Hono } from "hono";
import { z } from "zod";
import type { OrganizationRepository, PrismaClient } from "@resolution/database";
import { CreditWalletRepository } from "@resolution/database";
import { CREDIT_PACKS, findCreditPack, StripeClient } from "@resolution/billing";
import { writeAuditLog } from "@resolution/security";
import { auditLogWriter } from "@resolution/database";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { requireMinimumRole, resolveTenantContext } from "../middleware/tenant-context";
import { ValidationError, AppError } from "../lib/errors";
import type { AppEnv } from "../types";

const CreateCheckoutBody = z.object({ packId: z.string().min(1) });

/** Never the Stripe customer/payment-method ids — those are internal billing-provider
 *  references, not something the frontend needs. */
function toPublicWallet(wallet: {
  balance: number;
  currency: string;
  autoRechargeEnabled: boolean;
  autoRechargeThresholdCredits: number | null;
  autoRechargeAmountCredits: number | null;
  stripeCustomerId: string | null;
}) {
  return {
    balance: wallet.balance,
    currency: wallet.currency,
    autoRechargeEnabled: wallet.autoRechargeEnabled,
    autoRechargeThresholdCredits: wallet.autoRechargeThresholdCredits,
    autoRechargeAmountCredits: wallet.autoRechargeAmountCredits,
    hasPaymentMethod: wallet.stripeCustomerId !== null,
  };
}

function toPublicTransaction(t: {
  id: string;
  type: string;
  amount: number;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  balanceAfter: number;
  createdAt: Date;
}) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    relatedEntityType: t.relatedEntityType,
    relatedEntityId: t.relatedEntityId,
    balanceAfter: t.balanceAfter,
    createdAt: t.createdAt,
  };
}

/**
 * Self-serve credit purchases (ARCHITECTURE.md's Billing & Credits) — a one-time pack via
 * Stripe Checkout, 20% cheaper per credit than the (not-yet-built) auto-recharge rate
 * (packages/billing/src/packs.ts). Owner-only, matching the nav split in
 * apps/web/app/dashboard/layout.tsx: managing money is an Owner power, distinct from the
 * org-configuration powers an Admin already has.
 *
 * **Not yet built**: auto-recharge itself (an off-session charge when the balance crosses
 * a threshold) and real usage-based consumption debiting off AgentExecution's actual LLM
 * token costs — this ships the purchase → wallet ledger foundation those need. Consumption
 * transactions can already be recorded through `CreditWalletRepository.applyTransaction`
 * once something calls it; nothing does yet.
 */
export function buildBillingRoutes(deps: {
  db: PrismaClient;
  env: Env;
  organizationRepository: OrganizationRepository;
}): Hono<AppEnv> {
  const { db, env, organizationRepository } = deps;
  const router = new Hono<AppEnv>();
  const auth = authenticate(env.JWT_SECRET);
  const tenantContext = resolveTenantContext(organizationRepository);
  const requireOwner = requireMinimumRole("OWNER");

  router.get("/wallet", auth, tenantContext, requireOwner, async (c) => {
    const wallet = new CreditWalletRepository(db, c.get("tenantId")!);
    const w = await wallet.getOrCreate();
    const transactions = await wallet.listTransactions();
    return c.json({
      wallet: toPublicWallet(w),
      transactions: transactions.map(toPublicTransaction),
      packs: CREDIT_PACKS,
    });
  });

  router.post("/checkout", auth, tenantContext, requireOwner, async (c) => {
    const body = CreateCheckoutBody.parse(await c.req.json());
    const pack = findCreditPack(body.packId);
    if (!pack) throw new ValidationError("Unknown credit pack");

    const tenantId = c.get("tenantId")!;
    const walletRepo = new CreditWalletRepository(db, tenantId);
    const wallet = await walletRepo.getOrCreate();

    if (!env.STRIPE_SECRET_KEY) {
      if (env.NODE_ENV === "production" || !env.MOCK_MODE) {
        throw new AppError(
          "BILLING_UNAVAILABLE",
          "Billing is not configured. Contact platform support.",
          503,
        );
      }
      // Mock checkout — no Stripe account configured on this deployment. Applies the
      // purchase directly rather than pretending to charge a card, clearly labeled so it's
      // never mistaken for a real payment (same honesty discipline as every other
      // MOCK_MODE-style fallback in this codebase).
      const { wallet: updated } = await walletRepo.applyTransaction({
        type: "PURCHASE",
        amount: pack.credits,
        relatedEntityType: "CreditPack",
        relatedEntityId: pack.id,
      });
      await writeAuditLog(auditLogWriter(db), {
        tenantId,
        actorType: "user",
        actorId: c.get("userId"),
        action: "billing.mock_purchase",
        targetType: "CreditWallet",
        targetId: updated.id,
        requestId: c.get("requestId"),
        metadata: { packId: pack.id, credits: pack.credits },
      });
      return c.json({ mock: true, wallet: toPublicWallet(updated) });
    }

    const stripe = new StripeClient(env.STRIPE_SECRET_KEY);
    const session = await stripe.createCheckoutSession({
      productName: `${pack.name} — ${pack.credits.toLocaleString()} credits`,
      priceCents: pack.priceCents,
      currency: "usd",
      successUrl: `${env.CORS_ORIGIN}/dashboard/billing?checkout=success`,
      cancelUrl: `${env.CORS_ORIGIN}/dashboard/billing?checkout=canceled`,
      clientReferenceId: tenantId,
      customerId: wallet.stripeCustomerId ?? undefined,
      metadata: { tenantId, packId: pack.id, credits: String(pack.credits) },
    });

    return c.json({ mock: false, checkoutUrl: session.url });
  });

  return router;
}
