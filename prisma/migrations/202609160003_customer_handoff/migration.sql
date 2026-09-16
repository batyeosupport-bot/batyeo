-- Security fix: customer/handoff used to hand back the customer's own 7-day session secret
-- inside a deep-link URL, so a leaked link granted standing access to the session. The
-- customer's stable identity is now separate from any one session secret: CustomerSession
-- gains customerId, and a new CustomerHandoffToken is a short-lived (5 min), single-use
-- bridge that only ever mints a brand-new session for that same identity.
ALTER TABLE "CustomerSession" ADD COLUMN "customerId" TEXT NOT NULL;
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

CREATE TABLE "CustomerHandoffToken" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerHandoffToken_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerHandoffToken_expiresAt_idx" ON "CustomerHandoffToken"("expiresAt");
