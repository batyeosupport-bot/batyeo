-- Soft-delete only: a station's history (rentals, provider links, reconciliation records) all
-- reference its id, and the Postgres repository's sync() refuses to let any row disappear from a
-- write (infrastructure/postgres/repository.ts). Archiving hides it from the public API and the
-- kiosk instead of deleting the row.
ALTER TABLE "Station" ADD COLUMN "archivedAt" TIMESTAMP(3);
