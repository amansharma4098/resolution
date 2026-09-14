import type { CreditTransaction, CreditWallet, PrismaClient } from "@prisma/client";
import { TenantScopedRepository } from "../tenant-scoped-repository";

/** CreditTransactionType. PURCHASE/BONUS/TRIAL_GRANT/REFUND add to the balance;
 *  CONSUMPTION subtracts — applyTransaction is the only place that interprets which way. */
export type CreditTransactionType = "PURCHASE" | "CONSUMPTION" | "REFUND" | "BONUS" | "TRIAL_GRANT";

const DEBIT_TYPES = new Set<CreditTransactionType>(["CONSUMPTION"]);

export interface ApplyTransactionInput {
  type: CreditTransactionType;
  /** Always a positive magnitude — `type` says which direction it moves the balance. */
  amount: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** A Stripe Checkout Session id, for a PURCHASE row only — the idempotency key that stops
   *  a redelivered webhook from crediting the same purchase twice (unique in the schema). */
  stripeCheckoutSessionId?: string;
}

/** Same tenant-isolation contract as every other TenantScopedRepository — see
 *  CredentialRepository's header comment. */
export class CreditWalletRepository extends TenantScopedRepository {
  constructor(
    private readonly db: PrismaClient,
    tenantId: string,
  ) {
    super(tenantId);
  }

  get(): Promise<CreditWallet | null> {
    return this.db.creditWallet.findUnique({ where: { tenantId: this.tenantId } });
  }

  async getOrCreate(): Promise<CreditWallet> {
    const existing = await this.get();
    if (existing) return existing;
    // Created lazily, on first touch — an org that never buys credits never gets a row
    // (see schema.prisma's comment on CreditWallet).
    return this.db.creditWallet.create({ data: { tenantId: this.tenantId } });
  }

  async setStripeCustomerId(stripeCustomerId: string): Promise<void> {
    await this.db.creditWallet.update({ where: { tenantId: this.tenantId }, data: { stripeCustomerId } });
  }

  listTransactions(limit = 50): Promise<CreditTransaction[]> {
    return this.db.creditTransaction.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /** Idempotent on `stripeCheckoutSessionId` when given — a redelivered Stripe webhook
   *  event for a purchase already applied returns the existing transaction instead of
   *  crediting the wallet a second time. Checked both before writing (the fast path) and
   *  by catching the schema's unique-constraint violation (the race-safe backstop, since
   *  D1 has no interactive transaction to make the check-then-write atomic — same
   *  pre-computed-then-batched limitation as OrganizationRepository.createWithOwner). */
  async applyTransaction(
    input: ApplyTransactionInput,
  ): Promise<{ wallet: CreditWallet; transaction: CreditTransaction; alreadyApplied: boolean }> {
    if (input.stripeCheckoutSessionId) {
      const existing = await this.db.creditTransaction.findUnique({
        where: { stripeCheckoutSessionId: input.stripeCheckoutSessionId },
      });
      if (existing) {
        const wallet = await this.getOrCreate();
        return { wallet, transaction: existing, alreadyApplied: true };
      }
    }

    const wallet = await this.getOrCreate();
    const delta = DEBIT_TYPES.has(input.type) ? -input.amount : input.amount;
    const balanceAfter = wallet.balance + delta;

    try {
      const [updatedWallet, transaction] = await this.db.$transaction([
        this.db.creditWallet.update({ where: { tenantId: this.tenantId }, data: { balance: balanceAfter } }),
        this.db.creditTransaction.create({
          data: {
            tenantId: this.tenantId,
            type: input.type,
            amount: input.amount,
            relatedEntityType: input.relatedEntityType,
            relatedEntityId: input.relatedEntityId,
            balanceAfter,
            stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          },
        }),
      ]);
      return { wallet: updatedWallet, transaction, alreadyApplied: false };
    } catch (err) {
      // The unique-constraint backstop: a concurrent call already inserted this exact
      // checkout session's transaction between our check above and this write.
      if (input.stripeCheckoutSessionId) {
        const existing = await this.db.creditTransaction.findUnique({
          where: { stripeCheckoutSessionId: input.stripeCheckoutSessionId },
        });
        if (existing) {
          const current = await this.getOrCreate();
          return { wallet: current, transaction: existing, alreadyApplied: true };
        }
      }
      throw err;
    }
  }
}
