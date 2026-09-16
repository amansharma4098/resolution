CREATE TABLE "ChatConversation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "messages" TEXT NOT NULL DEFAULT '[]',
 "lockedUntil" REAL NOT NULL DEFAULT 0,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE,
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "ChatConversation_tenantId_userId_updatedAt_idx" ON "ChatConversation"("tenantId", "userId", "updatedAt");
