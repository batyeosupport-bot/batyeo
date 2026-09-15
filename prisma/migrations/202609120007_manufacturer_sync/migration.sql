DROP INDEX IF EXISTS "Station_providerDeviceId_key";
CREATE INDEX "Station_providerDeviceId_idx" ON "Station"("providerDeviceId");

CREATE TABLE "StationProviderLink" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationProviderLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StationProviderLink_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StationProviderLink_manufacturer_externalId_key" ON "StationProviderLink"("manufacturer", "externalId");
CREATE INDEX "StationProviderLink_stationId_active_idx" ON "StationProviderLink"("stationId", "active");
CREATE UNIQUE INDEX "StationProviderLink_one_active_per_manufacturer" ON "StationProviderLink"("stationId", "manufacturer") WHERE "active" = true;

CREATE TABLE "StationProviderSnapshot" (
  "id" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL,
  "online" BOOLEAN NOT NULL,
  "totalSlots" INTEGER NOT NULL,
  "emptySlots" INTEGER NOT NULL,
  "busySlots" INTEGER NOT NULL,
  "availability" INTEGER NOT NULL,
  "signal" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopName" TEXT NOT NULL,
  "shopAddress" TEXT NOT NULL,
  "slots" JSONB NOT NULL,
  CONSTRAINT "StationProviderSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StationProviderSnapshot_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "StationProviderLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StationProviderSnapshot_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StationProviderSnapshot_linkId_key" ON "StationProviderSnapshot"("linkId");
CREATE INDEX "StationProviderSnapshot_stationId_syncedAt_idx" ON "StationProviderSnapshot"("stationId", "syncedAt");

CREATE TABLE "ReconciliationRecord" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "position" INTEGER,
  "localValue" JSONB NOT NULL,
  "providerValue" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReconciliationRecord_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReconciliationRecord_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "StationProviderLink"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReconciliationRecord_stationId_status_lastDetectedAt_idx" ON "ReconciliationRecord"("stationId", "status", "lastDetectedAt");
CREATE INDEX "ReconciliationRecord_linkId_status_idx" ON "ReconciliationRecord"("linkId", "status");
CREATE UNIQUE INDEX "ReconciliationRecord_one_open_difference" ON "ReconciliationRecord"("linkId", "kind", COALESCE("position", -1)) WHERE "status" = 'OPEN';

CREATE TABLE "ManufacturerSyncRun" (
  "id" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "requestedBy" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "total" INTEGER NOT NULL,
  "succeeded" INTEGER NOT NULL,
  "failed" INTEGER NOT NULL,
  CONSTRAINT "ManufacturerSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManufacturerSyncRun_status_startedAt_idx" ON "ManufacturerSyncRun"("status", "startedAt");
