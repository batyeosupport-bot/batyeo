ALTER TABLE "Rental" ADD COLUMN "paymentState" TEXT;
ALTER TABLE "Rental" ADD COLUMN "physicalState" TEXT;
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE "Payment" ADD COLUMN "providerReference" TEXT;
ALTER TABLE "Payment" ADD COLUMN "error" TEXT;
ALTER TABLE "Payment" ADD COLUMN "requestedCents" INTEGER;
CREATE INDEX "Payment_providerReference_idx" ON "Payment"("providerReference");
