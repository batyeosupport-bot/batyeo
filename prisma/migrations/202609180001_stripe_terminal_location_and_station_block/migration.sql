-- Two independent fixes, bundled because both only touch Station:
-- 1. stripeTerminalLocationId/stripeTerminalLocationUpdatedAt were used throughout core/ and
--    tested against the in-memory repository, but were never added to this schema — writing one
--    through station/stripe-location against real PostgreSQL would have thrown at the Prisma
--    layer ("Unknown argument"). Reads silently no-opped to null instead of failing, which is why
--    this went unnoticed until the feature was actually exercised end-to-end.
-- 2. rentalsBlocked/rentalsBlockedReason/rentalsBlockedAt: a remote maintenance switch so an
--    operator can stop new rentals on a station without touching its online/failure fields
--    (those already carry other meaning read by the manufacturer sync and kiosk runtime).
ALTER TABLE "Station" ADD COLUMN "stripeTerminalLocationId" TEXT;
ALTER TABLE "Station" ADD COLUMN "stripeTerminalLocationUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Station" ADD COLUMN "rentalsBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Station" ADD COLUMN "rentalsBlockedReason" TEXT;
ALTER TABLE "Station" ADD COLUMN "rentalsBlockedAt" TIMESTAMP(3);
