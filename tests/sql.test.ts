import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
// Executes actual PostgreSQL SQL/PLpgSQL in WASM. Does not certify a networked PG deployment.
test('PostgreSQL migrations and constraints execute on the PGlite PostgreSQL engine',async()=>{
 const db=new PGlite();
 try{
  const migrations=readdirSync('prisma/migrations',{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  for(const migration of migrations) await db.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));
  for(const table of ['RuntimeCredential','RuntimeEnrollmentToken','HardwareDiscoveryReport','StationCapability']) {
   const found=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=$1",[table]);
   assert.equal(found.rows.length,1,table);
  }
  await db.exec(`INSERT INTO "RuntimeCredential" (id,"runtimeId","stationId","partnerId",digest,"createdAt") VALUES ('cred','runtime','s','p','digest',now())`);
  await assert.rejects(()=>db.exec(`INSERT INTO "RuntimeCredential" (id,"runtimeId","stationId","partnerId",digest,"createdAt") VALUES ('duplicate','runtime','s','p','digest',now())`));
  await db.exec(`UPDATE "RuntimeCredential" SET "revokedAt"=now() WHERE id='cred'`);
  const revoked=await db.query(`SELECT id FROM "RuntimeCredential" WHERE id='cred' AND "revokedAt" IS NOT NULL`);
  assert.equal(revoked.rows.length,1);
  await db.exec(`INSERT INTO "StationCapability" (id,"stationId",capability,status,source) VALUES ('cap','s','TOUCH','UNKNOWN','manual')`);
  await assert.rejects(()=>db.exec(`INSERT INTO "StationCapability" (id,"stationId",capability,status,source) VALUES ('duplicate','s','TOUCH','UNKNOWN','manual')`));
  const indexes=await db.query<{indexname:string}>(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`);
  for(const expected of ['Rental_open_customer','Rental_open_battery','PricingStrategy_one_active','Rental_partnerId_createdAt_idx','User_email_case_insensitive','WebhookEvent_source_externalId_key','Payment_providerReference_idx','Station_providerDeviceId_idx','Station_provider_status_idx','StationProviderLink_manufacturer_externalId_key','StationProviderLink_one_active_per_manufacturer','ReconciliationRecord_one_open_difference','ManufacturerSyncRun_provider_startedAt_idx'])assert.ok(indexes.rows.some(r=>r.indexname===expected),expected);
  await db.exec(`INSERT INTO "Partner" (id,name,city,"commissionBps") VALUES ('p','Partner','Paris',2000);`);
  await assert.rejects(()=>db.exec(`INSERT INTO "User" (id,email,name,"passwordHash",role,"partnerId") VALUES ('u','u@test.fr','User','hash','SUPER_ADMIN','p')`));
  await assert.rejects(()=>db.exec(`INSERT INTO "PricingStrategy" (id,"hourlyCents","capCents","depositCents","deadlineHours","commissionBps",active) VALUES ('bad',200,100,2000,48,2000,true)`));
  await db.exec(`INSERT INTO "PricingStrategy" (id,"hourlyCents","capCents","depositCents","deadlineHours","commissionBps",active) VALUES ('standard',200,800,2000,48,2000,true)`);
  await assert.rejects(()=>db.exec(`UPDATE "PricingStrategy" SET "hourlyCents"=300 WHERE id='standard'`));
  await db.exec(`INSERT INTO "User" (id,email,name,"passwordHash",role) VALUES ('u','ADMIN@test.fr','User','hash','ADMIN')`);
  await assert.rejects(()=>db.exec(`INSERT INTO "User" (id,email,name,"passwordHash",role) VALUES ('u2','admin@test.fr','User','hash','ADMIN')`));
  await db.exec(`INSERT INTO "AuditLog" (id,"userId",action) VALUES ('a','u','test')`);
  await assert.rejects(()=>db.exec(`DELETE FROM "AuditLog" WHERE id='a'`));
  await db.exec(`INSERT INTO "Venue" (id,"partnerId",name,city,address,category,hours) VALUES ('v','p','Venue','Paris','Demo','Hotel','24h')`);
  await assert.rejects(()=>db.exec(`INSERT INTO "Station" (id,"publicId","venueId","partnerId",capacity) VALUES ('s','s','v','other',4)`));
  await db.exec(`INSERT INTO "Station" (id,"publicId","venueId","partnerId",capacity) VALUES ('s','s','v','p',4)`);
  await db.exec(`INSERT INTO "StationProviderLink" (id,"stationId",manufacturer,"externalId","createdAt","updatedAt") VALUES ('link','s','BAJIE','BJH02347',now(),now())`);
  await assert.rejects(()=>db.exec(`INSERT INTO "StationProviderLink" (id,"stationId",manufacturer,"externalId","createdAt","updatedAt") VALUES ('duplicate','s','BAJIE','BJH02347',now(),now())`));
  await assert.rejects(()=>db.exec(`INSERT INTO "StationProviderLink" (id,"stationId",manufacturer,"externalId","createdAt","updatedAt") VALUES ('second-active','s','BAJIE','OTHER',now(),now())`));
  await assert.rejects(()=>db.exec(`INSERT INTO "Battery" (id,charge,status) VALUES ('orphan',100,'AVAILABLE')`));
  await db.exec(`BEGIN; INSERT INTO "Battery" (id,charge,status) VALUES ('battery',100,'AVAILABLE'); INSERT INTO "Slot" (id,"stationId",position,"batteryId") VALUES ('slot','s',1,'battery'); COMMIT;`);
  await assert.rejects(()=>db.exec(`INSERT INTO "Slot" (id,"stationId",position,"batteryId") VALUES ('slot2','s',2,'battery')`));
  const p={id:'standard',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000};
  await db.query(`INSERT INTO "Rental" (id,"customerId","partnerId","stationId","pricingId","pricingSnapshot","idempotencyKey",state) VALUES ('r','c','p','s','standard',$1,'key','CREATED')`,[JSON.stringify(p)]);
  await assert.rejects(()=>db.query(`INSERT INTO "Rental" (id,"customerId","partnerId","stationId","pricingId","pricingSnapshot","idempotencyKey",state) VALUES ('r2','c','p','s','standard',$1,'other','CREATED')`,[JSON.stringify(p)]));
  await assert.rejects(()=>db.exec(`INSERT INTO "Payment" (id,"rentalId","authorizedCents","capturedCents","releasedCents",status) VALUES ('pay','r',2000,400,1800,'CAPTURED')`));
  await assert.rejects(()=>db.exec(`UPDATE "Rental" SET "customerId"='other' WHERE id='r'`));
 }finally{await db.close();}
});
