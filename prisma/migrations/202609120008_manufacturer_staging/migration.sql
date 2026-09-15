ALTER TABLE "ManufacturerSyncRun" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'BAJIE';
ALTER TABLE "ManufacturerSyncRun" ADD COLUMN "mismatches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ManufacturerSyncRun" ADD COLUMN "errorSummary" JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX "ManufacturerSyncRun_provider_startedAt_idx" ON "ManufacturerSyncRun"("provider", "startedAt");
