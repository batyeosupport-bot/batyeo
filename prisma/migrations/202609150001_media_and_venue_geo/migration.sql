ALTER TABLE "Venue" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Venue" ADD COLUMN "longitude" DOUBLE PRECISION;
CREATE TABLE "Media" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "uri" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "targetStationIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Media_status_idx" ON "Media"("status");
