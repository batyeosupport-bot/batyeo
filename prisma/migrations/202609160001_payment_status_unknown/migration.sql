-- core/types.ts::PAYMENT_STATES declares 9 values and core/invariants.ts accepts all of them,
-- but Payment_conservation only ever allowed 4 ('AUTHORIZED','CAPTURED','RELEASED','FAILED').
-- 'UNKNOWN' is a real, durably-persisted value written by core/rental.ts::markPaymentUnknown
-- whenever a Stripe capture/release call fails ambiguously (core/stripe-coordinator.ts) — until
-- now that write would pass core/invariants.ts::validateData but be rejected by Postgres itself.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_conservation";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_conservation" CHECK (
 "authorizedCents">=0 AND "capturedCents">=0 AND "releasedCents">=0
 AND "capturedCents"+"releasedCents"<="authorizedCents"
 AND status IN ('PENDING','AUTHORIZING','AUTHORIZED','CAPTURING','CAPTURED','RELEASING','RELEASED','FAILED','UNKNOWN')
 AND (status NOT IN ('CAPTURED','RELEASED') OR "capturedCents"+"releasedCents"="authorizedCents")
 AND (status<>'RELEASED' OR "capturedCents"=0)
 AND (status<>'AUTHORIZED' OR ("capturedCents"=0 AND "releasedCents"=0))
 AND (status<>'FAILED' OR ("authorizedCents"=0 AND "capturedCents"=0 AND "releasedCents"=0)));
