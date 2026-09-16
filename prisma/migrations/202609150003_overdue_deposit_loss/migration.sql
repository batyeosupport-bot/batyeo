-- Battery never returned: after 48h in OVERDUE the deposit is captured in full and the rental
-- moves to the new terminal state LOST. Mirrors core/invariants.ts and core/state-machine.ts.
ALTER TABLE "Battery" DROP CONSTRAINT "Battery_values";
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_values" CHECK (charge BETWEEN 0 AND 100 AND status IN ('AVAILABLE','RENTED','MAINTENANCE','LOST'));

ALTER TABLE "Rental" DROP CONSTRAINT "Rental_started_fields";
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_started_fields" CHECK (
 state NOT IN ('ACTIVE','OVERDUE','RETURN_PENDING','RETURNED','COMPLETED','LOST')
 OR ("batteryId" IS NOT NULL AND "startedAt" IS NOT NULL AND deadline IS NOT NULL
 AND deadline="startedAt"+("pricingSnapshot"->>'deadlineHours')::integer * INTERVAL '1 hour'));

-- LOST joins the immutable terminal states: once the deposit is forfeited, the rental cannot change.
CREATE OR REPLACE FUNCTION batyeo_rental_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."partnerId" IS DISTINCT FROM OLD."partnerId"
 OR NEW."stationId" IS DISTINCT FROM OLD."stationId" OR NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot"
 OR NEW."pricingId" IS DISTINCT FROM OLD."pricingId" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
 OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
  RAISE EXCEPTION 'BATYEO rental identity and tariff are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('COMPLETED','CANCELLED','EXPIRED','PAYMENT_FAILED','EJECTION_FAILED','LOST') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'BATYEO terminal rental is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;

-- A LOST battery behaves like a RENTED one for occupancy (out of every slot), but its open rental
-- is the terminal LOST state rather than one of the in-flight states.
CREATE OR REPLACE FUNCTION batyeo_check_battery_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Battery" b WHERE
  (b.status IN ('RENTED','LOST') AND (EXISTS(SELECT 1 FROM "Slot" s WHERE s."batteryId"=b.id)
   OR NOT EXISTS(SELECT 1 FROM "Rental" r WHERE r."batteryId"=b.id AND (
     (b.status='RENTED' AND r.state IN ('ACTIVE','OVERDUE','EJECTING','RETURN_PENDING','RETURNED','ERROR'))
     OR (b.status='LOST' AND r.state='LOST')))))
  OR (b.status NOT IN ('RENTED','LOST') AND (SELECT count(*) FROM "Slot" s WHERE s."batteryId"=b.id)<>1)) THEN
  RAISE EXCEPTION 'BATYEO battery occupancy invariant' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM "Slot" s JOIN "Station" st ON st.id=s."stationId" WHERE s.position>st.capacity) THEN
  RAISE EXCEPTION 'BATYEO slot exceeds capacity' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;

-- A LOST rental is a flat deposit forfeiture, not a usage-priced settlement: only require that the
-- full authorized deposit ended up captured (no usage/commission arithmetic, unlike COMPLETED).
CREATE OR REPLACE FUNCTION batyeo_check_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Rental" r LEFT JOIN "Payment" p ON p."rentalId"=r.id WHERE r.state='COMPLETED' AND (
  p.id IS NULL OR p.status<>'CAPTURED' OR p."capturedCents"<>r."amountCents"
  OR p."authorizedCents"<>(r."pricingSnapshot"->>'depositCents')::integer
  OR r."commissionCents"<>floor(r."amountCents"::numeric*(r."pricingSnapshot"->>'commissionBps')::integer/10000)
  OR r."amountCents"<>LEAST((r."pricingSnapshot"->>'capCents')::integer,
    GREATEST(1,ceil((extract(epoch FROM (r."returnedAt"-r."startedAt"))+r."simulatedMinutes"*60)/3600))*(r."pricingSnapshot"->>'hourlyCents')::integer))) THEN
  RAISE EXCEPTION 'BATYEO settlement invariant' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM "Rental" r LEFT JOIN "Payment" p ON p."rentalId"=r.id WHERE r.state='LOST' AND (
  p.id IS NULL OR p.status<>'CAPTURED' OR p."capturedCents"<>p."authorizedCents")) THEN
  RAISE EXCEPTION 'BATYEO lost rental deposit forfeiture invariant' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;
