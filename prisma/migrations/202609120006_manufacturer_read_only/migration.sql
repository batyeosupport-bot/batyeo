ALTER TABLE "Station" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE "Station" ADD COLUMN "providerDeviceId" TEXT;
ALTER TABLE "Station" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "Station" ADD COLUMN "providerLastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Station" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Station_providerDeviceId_key" ON "Station"("providerDeviceId");
CREATE INDEX "Station_provider_status_idx" ON "Station"("provider", "online");
