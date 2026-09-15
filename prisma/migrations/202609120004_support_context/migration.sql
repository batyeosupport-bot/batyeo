ALTER TABLE "SupportTicket" ADD COLUMN "rentalId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "stationId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "batteryId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "paymentId" TEXT;
CREATE INDEX "SupportTicket_rentalId_idx" ON "SupportTicket"("rentalId");
