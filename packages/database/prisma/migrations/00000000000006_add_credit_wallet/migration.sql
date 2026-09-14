-- Adds the billing/credits system — see schema.prisma's comments on CreditWallet and
-- CreditTransaction.
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "autoRechargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRechargeThresholdCredits" INTEGER,
    "autoRechargeAmountCredits" INTEGER,
    "stripeCustomerId" TEXT,
    "stripePaymentMethodId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditWallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CreditWallet_tenantId_key" ON "CreditWallet"("tenantId");

CREATE INDEX "CreditWallet_tenantId_idx" ON "CreditWallet"("tenantId");

CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CreditTransaction_stripeCheckoutSessionId_key" ON "CreditTransaction"("stripeCheckoutSessionId");

CREATE INDEX "CreditTransaction_tenantId_createdAt_idx" ON "CreditTransaction"("tenantId", "createdAt");
