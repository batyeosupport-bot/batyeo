-- One process-independent serialization gate, initialized by migration, never lazily seeded.
INSERT INTO "CoreRevision" (id,version) VALUES (1,0);

CREATE UNIQUE INDEX "Rental_open_customer" ON "Rental" ("customerId")
WHERE state IN ('CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','OVERDUE','ERROR');
CREATE UNIQUE INDEX "Rental_open_battery" ON "Rental" ("batteryId")
WHERE "batteryId" IS NOT NULL AND state IN ('CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','OVERDUE','ERROR');
CREATE UNIQUE INDEX "PricingStrategy_one_active" ON "PricingStrategy" (active) WHERE active;
CREATE UNIQUE INDEX "User_email_case_insensitive" ON "User" (lower(email));

ALTER TABLE "User" ADD CONSTRAINT "User_role_tenant" CHECK (
 (role IN ('PARTNER_ADMIN','PARTNER_USER') AND "partnerId" IS NOT NULL)
 OR (role NOT IN ('PARTNER_ADMIN','PARTNER_USER') AND "partnerId" IS NULL));
ALTER TABLE "User" ADD CONSTRAINT "User_partner_exists" FOREIGN KEY ("partnerId")
 REFERENCES "Partner" (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "User" ADD CONSTRAINT "User_auth_version" CHECK ("authVersion">=0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_auth_version" CHECK ("authVersion">=0);
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_values" CHECK (charge BETWEEN 0 AND 100 AND status IN ('AVAILABLE','RENTED','MAINTENANCE'));
ALTER TABLE "Station" ADD CONSTRAINT "Station_values" CHECK (capacity>0 AND failure IN ('none','ejection','timeout','payment'));
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_position_positive" CHECK (position>0);
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_commission_range" CHECK ("commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "PricingStrategy" ADD CONSTRAINT "PricingStrategy_bounds" CHECK (
 "hourlyCents">0 AND "capCents">="hourlyCents" AND "depositCents">="capCents"
 AND "deadlineHours">0 AND "commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_amounts" CHECK ("amountCents">=0 AND "commissionCents">=0 AND "commissionCents"<="amountCents" AND "simulatedMinutes">=0);
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_snapshot_bounds" CHECK (
 jsonb_typeof("pricingSnapshot")='object'
 AND "pricingSnapshot" ?& ARRAY['id','hourlyCents','capCents','depositCents','deadlineHours','commissionBps']
 AND ("pricingSnapshot"->>'id')="pricingId"
 AND ("pricingSnapshot"->>'hourlyCents')::integer>0
 AND ("pricingSnapshot"->>'capCents')::integer>=("pricingSnapshot"->>'hourlyCents')::integer
 AND ("pricingSnapshot"->>'depositCents')::integer>=("pricingSnapshot"->>'capCents')::integer
 AND ("pricingSnapshot"->>'deadlineHours')::integer>0
 AND ("pricingSnapshot"->>'commissionBps')::integer BETWEEN 0 AND 10000
 AND "amountCents"<=("pricingSnapshot"->>'capCents')::integer);
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_started_fields" CHECK (
 state NOT IN ('ACTIVE','OVERDUE','RETURN_PENDING','RETURNED','COMPLETED')
 OR ("batteryId" IS NOT NULL AND "startedAt" IS NOT NULL AND deadline IS NOT NULL
 AND deadline="startedAt"+("pricingSnapshot"->>'deadlineHours')::integer * INTERVAL '1 hour'));
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_completed_fields" CHECK (
 state<>'COMPLETED' OR ("returnedAt" IS NOT NULL AND "returnStationId" IS NOT NULL AND "returnedAt">="startedAt"));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_conservation" CHECK (
 "authorizedCents">=0 AND "capturedCents">=0 AND "releasedCents">=0
 AND "capturedCents"+"releasedCents"<="authorizedCents"
 AND status IN ('AUTHORIZED','CAPTURED','RELEASED','FAILED')
 AND (status NOT IN ('CAPTURED','RELEASED') OR "capturedCents"+"releasedCents"="authorizedCents")
 AND (status<>'RELEASED' OR "capturedCents"=0)
 AND (status<>'AUTHORIZED' OR ("capturedCents"=0 AND "releasedCents"=0))
 AND (status<>'FAILED' OR ("authorizedCents"=0 AND "capturedCents"=0 AND "releasedCents"=0)));
ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_nonnegative" CHECK (count>=0);
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_status" CHECK (status IN ('OPEN','RESOLVED'));

-- Immutable evidence; pricing activation can change but its financial fields cannot.
CREATE FUNCTION batyeo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BATYEO immutable evidence: %', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON "RentalEvent" FOR EACH ROW EXECUTE FUNCTION batyeo_immutable();
CREATE TRIGGER terms_immutable BEFORE UPDATE OR DELETE ON "TermsAcceptance" FOR EACH ROW EXECUTE FUNCTION batyeo_immutable();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION batyeo_immutable();
CREATE FUNCTION batyeo_pricing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') THEN
  RAISE EXCEPTION 'BATYEO pricing version is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER pricing_immutable BEFORE UPDATE ON "PricingStrategy" FOR EACH ROW EXECUTE FUNCTION batyeo_pricing_immutable();
CREATE FUNCTION batyeo_rental_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."partnerId" IS DISTINCT FROM OLD."partnerId"
 OR NEW."stationId" IS DISTINCT FROM OLD."stationId" OR NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot"
 OR NEW."pricingId" IS DISTINCT FROM OLD."pricingId" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
 OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
  RAISE EXCEPTION 'BATYEO rental identity and tariff are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('COMPLETED','CANCELLED','EXPIRED','PAYMENT_FAILED','EJECTION_FAILED') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'BATYEO terminal rental is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER rental_immutable BEFORE UPDATE ON "Rental" FOR EACH ROW EXECUTE FUNCTION batyeo_rental_immutable();

-- Deferred cross-table invariants are evaluated at commit, after all domain writes.
CREATE FUNCTION batyeo_check_battery_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Battery" b WHERE
  (b.status='RENTED' AND (EXISTS(SELECT 1 FROM "Slot" s WHERE s."batteryId"=b.id)
   OR NOT EXISTS(SELECT 1 FROM "Rental" r WHERE r."batteryId"=b.id AND r.state IN ('ACTIVE','OVERDUE','EJECTING','RETURN_PENDING','RETURNED','ERROR'))))
  OR (b.status<>'RENTED' AND (SELECT count(*) FROM "Slot" s WHERE s."batteryId"=b.id)<>1)) THEN
  RAISE EXCEPTION 'BATYEO battery occupancy invariant' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM "Slot" s JOIN "Station" st ON st.id=s."stationId" WHERE s.position>st.capacity) THEN
  RAISE EXCEPTION 'BATYEO slot exceeds capacity' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER battery_location AFTER INSERT OR UPDATE OR DELETE ON "Battery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_battery_location();
CREATE CONSTRAINT TRIGGER slot_location AFTER INSERT OR UPDATE OR DELETE ON "Slot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_battery_location();
CREATE CONSTRAINT TRIGGER rental_location AFTER INSERT OR UPDATE OR DELETE ON "Rental" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_battery_location();
CREATE CONSTRAINT TRIGGER station_capacity AFTER UPDATE ON "Station" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_battery_location();
CREATE FUNCTION batyeo_check_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Rental" r LEFT JOIN "Payment" p ON p."rentalId"=r.id WHERE r.state='COMPLETED' AND (
  p.id IS NULL OR p.status<>'CAPTURED' OR p."capturedCents"<>r."amountCents"
  OR p."authorizedCents"<>(r."pricingSnapshot"->>'depositCents')::integer
  OR r."commissionCents"<>floor(r."amountCents"::numeric*(r."pricingSnapshot"->>'commissionBps')::integer/10000)
  OR r."amountCents"<>LEAST((r."pricingSnapshot"->>'capCents')::integer,
    GREATEST(1,ceil((extract(epoch FROM (r."returnedAt"-r."startedAt"))+r."simulatedMinutes"*60)/3600))*(r."pricingSnapshot"->>'hourlyCents')::integer))) THEN
  RAISE EXCEPTION 'BATYEO settlement invariant' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER rental_settlement AFTER INSERT OR UPDATE ON "Rental" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_settlement();
CREATE CONSTRAINT TRIGGER payment_settlement AFTER INSERT OR UPDATE OR DELETE ON "Payment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION batyeo_check_settlement();
