CREATE TABLE "RuntimeCredential" (
  "id" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "RuntimeCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RuntimeCredential_runtimeId_key" ON "RuntimeCredential"("runtimeId");
CREATE INDEX "RuntimeCredential_stationId_revokedAt_idx" ON "RuntimeCredential"("stationId", "revokedAt");
CREATE INDEX "RuntimeCredential_partnerId_idx" ON "RuntimeCredential"("partnerId");
CREATE TABLE "RuntimeEnrollmentToken" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "RuntimeEnrollmentToken_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RuntimeEnrollmentToken_stationId_expiresAt_idx" ON "RuntimeEnrollmentToken"("stationId", "expiresAt");
CREATE INDEX "RuntimeEnrollmentToken_partnerId_expiresAt_idx" ON "RuntimeEnrollmentToken"("partnerId", "expiresAt");
CREATE TABLE "HardwareDiscoveryReport" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "runtimeId" TEXT NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL,
  "report" JSONB NOT NULL,
  CONSTRAINT "HardwareDiscoveryReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HardwareDiscoveryReport_stationId_collectedAt_idx" ON "HardwareDiscoveryReport"("stationId", "collectedAt");
CREATE INDEX "HardwareDiscoveryReport_runtimeId_collectedAt_idx" ON "HardwareDiscoveryReport"("runtimeId", "collectedAt");
CREATE TABLE "StationCapability" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "evidence" TEXT,
  "version" TEXT,
  CONSTRAINT "StationCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StationCapability_stationId_capability_key" ON "StationCapability"("stationId", "capability");
CREATE INDEX "StationCapability_stationId_status_idx" ON "StationCapability"("stationId", "status");
