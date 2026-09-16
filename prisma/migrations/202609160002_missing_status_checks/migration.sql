-- Tables added after 202609120002_integrity never received the CHECK constraints that harden
-- every other status/enum-like column against a write that bypasses core/invariants.ts.
-- core/types.ts already declares strict unions for all of these; this migration only catches up.
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_physical_state" CHECK (
 "physicalState" IS NULL OR "physicalState" IN ('IDLE','EJECTING','EJECTED','RETURN_PENDING','RETURNED','FAILED','UNKNOWN'));
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_status" CHECK (
 status IN ('RECEIVED','UNTRUSTED','PROCESSED','FAILED'));
ALTER TABLE "ReconciliationRecord" ADD CONSTRAINT "ReconciliationRecord_status" CHECK (
 status IN ('OPEN','RESOLVED'));
ALTER TABLE "ManufacturerSyncRun" ADD CONSTRAINT "ManufacturerSyncRun_status" CHECK (
 status IN ('RUNNING','COMPLETED','PARTIAL','FAILED'));
ALTER TABLE "ManufacturerSyncRun" ADD CONSTRAINT "ManufacturerSyncRun_trigger" CHECK (
 trigger IN ('SCHEDULED','MANUAL','WEBHOOK'));
