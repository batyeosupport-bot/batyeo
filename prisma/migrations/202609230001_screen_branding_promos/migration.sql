-- Habillage des écrans par établissement, promos programmées des bars, fiche légale des
-- partenaires. Répare aussi deux données jamais persistées en Postgres : la configuration
-- d'affichage des bornes (texte d'accueil, bandeau, traductions) et leur dernier signal de vie,
-- qui repartaient à vide à chaque requête. Rejouable sans erreur (IF NOT EXISTS partout).
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "legalName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "siret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "contactName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "iban" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "contractStartedAt" TIMESTAMP(3);

ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "branding" JSONB;

CREATE TABLE IF NOT EXISTS "VenuePromo" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL,
  "highlight" TEXT NOT NULL,
  "imageUrl" TEXT,
  "days" JSONB NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "durationMs" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VenuePromo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenuePromo_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VenuePromo_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','ARCHIVED')),
  CONSTRAINT "VenuePromo_minutes_check" CHECK ("startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1440)
);
CREATE INDEX IF NOT EXISTS "VenuePromo_venueId_idx" ON "VenuePromo"("venueId");

CREATE TABLE IF NOT EXISTS "DisplayConfig" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "idleContent" TEXT NOT NULL,
  "supportContact" TEXT NOT NULL,
  "maintenanceBanner" TEXT,
  "locale" TEXT NOT NULL,
  "refreshIntervalMs" INTEGER NOT NULL,
  "featureFlags" JSONB NOT NULL,
  "translations" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DisplayConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DisplayConfig_stationId_key" ON "DisplayConfig"("stationId");

CREATE TABLE IF NOT EXISTS "StationHeartbeat" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "StationHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StationHeartbeat_stationId_key" ON "StationHeartbeat"("stationId");

-- Une batterie sortie de sa borne sans location BATYEO (flux natif du fabricant, retrait à la
-- main) devient MISSING : hors de tout slot, sans location exigée. Sans ce statut, le miroir
-- automatique de la borne ne pouvait pas refléter une sortie, et le compte affiché mentait.
ALTER TABLE "Battery" DROP CONSTRAINT IF EXISTS "Battery_values";
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_values" CHECK (charge BETWEEN 0 AND 100 AND status IN ('AVAILABLE','RENTED','MAINTENANCE','LOST','MISSING'));
CREATE OR REPLACE FUNCTION batyeo_check_battery_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Battery" b WHERE
  (b.status IN ('RENTED','LOST') AND (EXISTS(SELECT 1 FROM "Slot" s WHERE s."batteryId"=b.id)
   OR NOT EXISTS(SELECT 1 FROM "Rental" r WHERE r."batteryId"=b.id AND (
     (b.status='RENTED' AND r.state IN ('ACTIVE','OVERDUE','EJECTING','RETURN_PENDING','RETURNED','ERROR'))
     OR (b.status='LOST' AND r.state='LOST')))))
  OR (b.status='MISSING' AND EXISTS(SELECT 1 FROM "Slot" s WHERE s."batteryId"=b.id))
  OR (b.status NOT IN ('RENTED','LOST','MISSING') AND (SELECT count(*) FROM "Slot" s WHERE s."batteryId"=b.id)<>1)) THEN
  RAISE EXCEPTION 'BATYEO battery occupancy invariant' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM "Slot" s JOIN "Station" st ON st.id=s."stationId" WHERE s.position>st.capacity) THEN
  RAISE EXCEPTION 'BATYEO slot exceeds capacity' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;
