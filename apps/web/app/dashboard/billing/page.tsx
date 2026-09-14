"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusBadge } from "@resolution/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiRequest } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Wallet {
  balance: number;
  currency: string;
  autoRechargeEnabled: boolean;
  autoRechargeThresholdCredits: number | null;
  autoRechargeAmountCredits: number | null;
  hasPaymentMethod: boolean;
}

interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  baselinePriceCents: number;
}

interface Transaction {
  id: string;
  type: "PURCHASE" | "CONSUMPTION" | "REFUND" | "BONUS" | "TRIAL_GRANT";
  amount: number;
  balanceAfter: number;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const TRANSACTION_STATUS: Record<Transaction["type"], "success" | "warning" | "info" | "neutral"> = {
  PURCHASE: "success",
  BONUS: "success",
  TRIAL_GRANT: "success",
  REFUND: "info",
  CONSUMPTION: "neutral",
};

// useSearchParams() opts a page out of static prerendering unless wrapped in Suspense —
// required here since apps/web builds as a static export (next.config.js).
export default function BillingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-subink">Loading…</p>}>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const { currentTenantId } = useSession();
  const checkoutResult = useSearchParams().get("checkout");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ wallet: Wallet; packs: CreditPack[]; transactions: Transaction[] }>(
        "/api/billing/wallet",
        { tenantId: currentTenantId },
      );
      setWallet(res.wallet);
      setPacks(res.packs);
      setTransactions(res.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [currentTenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleBuy(packId: string) {
    if (!currentTenantId) return;
    setBuyingPackId(packId);
    setError(null);
    try {
      const res = await apiRequest<{ mock: boolean; checkoutUrl?: string; wallet?: Wallet }>(
        "/api/billing/checkout",
        { method: "POST", tenantId: currentTenantId, body: { packId } },
      );
      if (res.mock) {
        // No Stripe account configured on this deployment — the purchase is applied
        // directly server-side; just reload to show the new balance.
        await load();
      } else if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start checkout");
    } finally {
      setBuyingPackId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="kicker">Owner</span>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Billing & Credits</h1>
        <p className="mt-1 max-w-2xl text-sm text-subink">
          One credit = real cost — LLM tokens and remediation execution. One-time packs are
          20% cheaper per credit than the pay-as-you-go rate.
        </p>
      </div>

      {checkoutResult === "success" && (
        <p className="rounded border border-success bg-background px-3 py-2 text-sm text-ink">
          Payment received — your balance below reflects it once Stripe&apos;s webhook lands
          (usually instant; refresh if it hasn&apos;t yet).
        </p>
      )}
      {checkoutResult === "canceled" && (
        <p className="rounded border border-border bg-background px-3 py-2 text-sm text-subink">
          Checkout was canceled — no charge was made.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      {loading ? (
        <p className="text-sm text-subink">Loading…</p>
      ) : (
        <>
          <Card emphasized>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
              <div>
                <p className="text-xs text-ice">Balance</p>
                <p className="font-display text-3xl font-semibold text-white">
                  {wallet?.balance.toLocaleString() ?? 0} credits
                </p>
              </div>
              <p className="text-xs text-ice">
                {wallet?.hasPaymentMethod ? "Payment method on file" : "No payment method on file yet"}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            {packs.map((pack) => (
              <Card key={pack.id}>
                <CardHeader>
                  <CardTitle>{pack.name}</CardTitle>
                  <CardDescription>{pack.credits.toLocaleString()} credits</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div>
                    <span className="font-display text-2xl font-semibold text-ink">
                      {formatCents(pack.priceCents)}
                    </span>{" "}
                    <span className="text-sm text-subink line-through">{formatCents(pack.baselinePriceCents)}</span>
                    <p className="text-xs text-success">20% off the pay-as-you-go rate</p>
                  </div>
                  <Button onClick={() => void handleBuy(pack.id)} disabled={buyingPackId === pack.id} className="w-full">
                    {buyingPackId === pack.id ? "Starting checkout…" : "Buy"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Transaction history</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-subink">No transactions yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {transactions.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={TRANSACTION_STATUS[t.type]}>{t.type}</StatusBadge>
                        <span className="text-ink">
                          {t.type === "CONSUMPTION" ? "-" : "+"}
                          {t.amount.toLocaleString()} credits
                        </span>
                        {t.relatedEntityType && (
                          <span className="font-mono text-xs text-subink">{t.relatedEntityType}</span>
                        )}
                      </div>
                      <span className="text-xs text-subink">
                        balance {t.balanceAfter.toLocaleString()} · {new Date(t.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
