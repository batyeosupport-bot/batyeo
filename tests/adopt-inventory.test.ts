import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData,type Data} from '../core/types';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {adoptProviderInventory,INVENTORY_SNAPSHOT_MAX_AGE_MS} from '../core/station-admin';
import {linkManufacturerStation,ManufacturerSyncService,moveManufacturerLink} from '../core/manufacturer-sync';
import {setBatteryService} from '../core/station-admin';
import {stationViews} from '../core/queries';
import {MockBatteryStationProvider,PROVIDER_SNAPSHOT_FRESH_MS} from '../core/providers';
import {ManufacturerApiError,ManufacturerError} from '../core/manufacturer';
import {RentalEngine} from '../core/rental';
import type {ManufacturerDeviceSnapshot} from '../core/manufacturer';
import type {Repository} from '../core/repository';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(data:Data)=>T){const next=structuredClone(this.data),value=fn(next);validateData(next);this.data=next;return value;}}
const cabinet=(deviceId:string,ids:(string|null)[],online=true):ManufacturerDeviceSnapshot=>({deviceId,cabinetId:'c',qrCode:'q',online,totalSlots:ids.length,emptySlots:ids.filter(x=>!x).length,busySlots:ids.filter(Boolean).length,signal:'s',type:'t',ip:'1.1.1.1',shopId:'shop',shopName:'n',shopAddress:'a',latitude:null,longitude:null,batteries:ids.flatMap((id,i)=>id?[{id,slot:i+1,voltage:4100}]:[]),slots:ids.map((id,i)=>({position:i+1,battery:id?{id,slot:i+1,voltage:4100}:null})),availability:ids.filter(Boolean).length,lastSeenAt:null});
// A fresh, history-free station — what an admin creates for a real cabinet.
const freshStation=()=>{const d=emptyData();const seeded=seedData('x');d.pricing=seeded.pricing;d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:null});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});d.stations.push({id:'s',publicId:'real-1',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:2});d.slots.push({id:'x1',stationId:'s',position:1,batteryId:null},{id:'x2',stationId:'s',position:2,batteryId:null});return d;};
async function synced(d:Data,ids:(string|null)[],at:number,online=true){linkManufacturerStation(d,'s','BAJIE','DTA1',at);const repo=new MemoryRepository(d);await new ManufacturerSyncService(repo,{getDeviceInfo:async id=>cabinet(id,ids,online)},{now:()=>at}).run({trigger:'MANUAL'});return repo;}

test('adoptProviderInventory mirrors the cabinet: real battery ids in their real slots, capacity from the cabinet',async()=>{
 const repo=await synced(freshStation(),['REAL-A',null,'REAL-C'],1_000);
 const result=await repo.transaction(d=>adoptProviderInventory(d,'s',2_000));
 assert.deepEqual(result,{batteries:2,slots:3});
 assert.equal(repo.data.stations[0].capacity,3);
 assert.deepEqual(repo.data.slots.filter(s=>s.stationId==='s').map(s=>[s.position,s.batteryId]),[[1,'REAL-A'],[2,null],[3,'REAL-C']]);
 assert.ok(repo.data.batteries.every(b=>b.status==='AVAILABLE'));
});

test('a rental on an adopted station ejects a real battery id, and the read-back closes it into a free slot',async()=>{
 const repo=await synced(freshStation(),['REAL-A','REAL-B'],1_000);await repo.transaction(d=>adoptProviderInventory(d,'s',1_500));
 const engine=new RentalEngine();
 const rental=await repo.transaction(d=>engine.start(d,'cust','s','key-1',2_000));
 assert.equal(rental.state,'ACTIVE');assert.match(rental.batteryId!,/^REAL-/);
 const rentedId=rental.batteryId!,other=rentedId==='REAL-A'?'REAL-B':'REAL-A';
 const at=2_000+10*60_000;
 await new ManufacturerSyncService(repo,{getDeviceInfo:async id=>cabinet(id,[rentedId,other])},{now:()=>at,onReturnDetected:(c,now)=>repo.transaction(d=>engine.return(d,c.rentalId,c.stationId,now,true))}).run({trigger:'WEBHOOK'});
 assert.equal(repo.data.rentals[0].state,'COMPLETED');
 assert.equal(repo.data.batteries.find(b=>b.id===rentedId)!.status,'AVAILABLE');
});

test('adoptProviderInventory refuses every unsafe case and changes nothing',async()=>{
 const check=async(prepare:(repo:MemoryRepository)=>Promise<void>|void,expected:RegExp,ids:(string|null)[]=['REAL-A'],now=2_000,online=true)=>{
  const repo=await synced(freshStation(),ids,1_000,online);await prepare(repo);const before=JSON.stringify(repo.data);
  await assert.rejects(repo.transaction(d=>adoptProviderInventory(d,'s',now)),expected);assert.equal(JSON.stringify(repo.data),before);
 };
 await check(()=>{}, /lecture récente/,['REAL-A'],1_000+INVENTORY_SNAPSHOT_MAX_AGE_MS+1);
 await check(()=>{}, /hors ligne/,['REAL-A'],2_000,false);
 await check(()=>{}, /deux fois/,['REAL-A','REAL-A']);
 await check(r=>{r.data.stations.push({id:'s2',publicId:'other-1',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:1});r.data.batteries.push({id:'REAL-A',charge:50,status:'AVAILABLE'});r.data.slots.push({id:'o',stationId:'s2',position:1,batteryId:'REAL-A'});},/existe déjà ailleurs/);
 // demo station: batteries carry rental history
 const demo=seedData('x');linkManufacturerStation(demo,'station-paris','BAJIE','DEMO',1_000);
 const drepo=new MemoryRepository(demo);await new ManufacturerSyncService(drepo,{getDeviceInfo:async id=>cabinet(id,['REAL-A'])},{now:()=>1_000}).run({trigger:'MANUAL',stationId:'station-paris'});
 await assert.rejects(drepo.transaction(d=>adoptProviderInventory(d,'station-paris',2_000)),/locations sont en cours/,'seeded demo rentals are still open');
 const history=drepo.data.rentals.find(r=>r.stationId==='station-paris'&&r.state==='COMPLETED')!;
 drepo.data.rentals=drepo.data.rentals.filter(r=>r.stationId!=='station-paris'||r.state==='COMPLETED');drepo.data.rentals.push({...history,id:'history-of-slotted-battery',batteryId:'BAT-PAR-003',idempotencyKey:'k-history'});
 await assert.rejects(drepo.transaction(d=>adoptProviderInventory(d,'station-paris',2_000)),/historique de démonstration/);
 await assert.rejects(new MemoryRepository(freshStation()).transaction(d=>adoptProviderInventory(d,'s',2_000)),/aucune borne fabricant/);
});

test('a cabinet reported offline stops the station from selling, whether it answers online:false or refuses with "device not online"',async()=>{
 const byRead=await synced(freshStation(),['REAL-A'],1_000,false);
 assert.equal(byRead.data.stations[0].online,false);
 assert.equal(byRead.data.stations[0].providerStatus,'OFFLINE');
 assert.throws(()=>new RentalEngine().start(byRead.data,'c','s','k',2_000),/hors ligne/);

 const live=freshStation();linkManufacturerStation(live,'s','BAJIE','DTA1',1_000);
 const repo=new MemoryRepository(live);
 await new ManufacturerSyncService(repo,{getDeviceInfo:async()=>{throw new ManufacturerApiError(2004,'Device not online.');}},{now:()=>2_000,attempts:1}).run({trigger:'SCHEDULED'});
 assert.equal(repo.data.stations[0].online,false,'a confirmed "device not online" is an offline cabinet');
 assert.equal(repo.data.stations[0].providerStatus,'ERROR');

 const flaky=freshStation();linkManufacturerStation(flaky,'s','BAJIE','DTA1',1_000);
 const frepo=new MemoryRepository(flaky);
 await new ManufacturerSyncService(frepo,{getDeviceInfo:async()=>{throw new ManufacturerError('timeout',504,'TIMEOUT');}},{now:()=>2_000,attempts:1}).run({trigger:'SCHEDULED'});
 assert.equal(frepo.data.stations[0].online,true,'a transport timeout says nothing about the cabinet — sales keep running');
});

test('a station never offers more batteries than a fresh cabinet read reported',async()=>{
 // Real timestamps: getAvailability() is the sales gate and reads the clock itself.
 const t=Date.now();
 const repo=await synced(freshStation(),['REAL-A','REAL-B'],t);await repo.transaction(d=>adoptProviderInventory(d,'s',t+500));
 assert.equal(stationViews(repo.data,t+1_000).find(s=>s.id==='s')!.available,2);
 // The cabinet now reports a single battery: one left through the manufacturer's own flow.
 await new ManufacturerSyncService(repo,{getDeviceInfo:async id=>cabinet(id,['REAL-A',null])},{now:()=>t+2_000}).run({trigger:'SCHEDULED'});
 assert.equal(stationViews(repo.data,t+2_100).find(s=>s.id==='s')!.available,1,'local bookkeeping may not out-promise the cabinet');
 assert.equal(new MockBatteryStationProvider().getAvailability(repo.data,'s'),1,'the sales gate applies the same cap');
 assert.equal(stationViews(repo.data,t+2_000+PROVIDER_SNAPSHOT_FRESH_MS+1).find(s=>s.id==='s')!.available,2,'a stale read stops capping');
});

test('a lost battery that comes back, and a damaged one, can both be put right without the demo simulator',()=>{
 const d=seedData('x');const battery=d.batteries.find(b=>b.status==='AVAILABLE')!;
 const slot=d.slots.find(s=>s.batteryId===battery.id)!;
 setBatteryService(d,battery.id,'MAINTENANCE');
 assert.equal(battery.status,'MAINTENANCE');
 assert.equal(d.slots.find(s=>s.id===slot.id)!.batteryId,battery.id,'a damaged battery stays physically in its slot');
 assert.equal(stationViews(d).find(s=>s.id===slot.stationId)!.available,d.slots.filter(s=>s.stationId===slot.stationId&&d.batteries.some(b=>b.id===s.batteryId&&b.status==='AVAILABLE')).length);
 validateData(d);
 setBatteryService(d,battery.id,'AVAILABLE');assert.equal(battery.status,'AVAILABLE');validateData(d);

 // A battery written off after 48 h, then physically returned.
 const lostRental=d.rentals.find(r=>r.state==='OVERDUE')!;lostRental.state='LOST';
 const lostPayment=d.payments.find(p=>p.rentalId===lostRental.id)!;
 lostPayment.status='CAPTURED';lostPayment.capturedCents=lostPayment.authorizedCents;lostPayment.releasedCents=0;lostRental.paymentState='CAPTURED';
 const lost=d.batteries.find(b=>b.id===lostRental.batteryId)!;lost.status='LOST';
 const lostSlot=d.slots.find(s=>s.batteryId===lost.id);if(lostSlot)lostSlot.batteryId=null;
 validateData(d);
 assert.throws(()=>setBatteryService(d,lost.id,'AVAILABLE'),/station où la batterie a été retrouvée/);
 assert.throws(()=>setBatteryService(d,lost.id,'MAINTENANCE'),/perdue/);
 setBatteryService(d,lost.id,'AVAILABLE','station-lille');
 assert.equal(lost.status,'AVAILABLE');
 assert.equal(d.slots.find(s=>s.batteryId===lost.id)!.stationId,'station-lille');
 validateData(d);

 const rented=d.rentals.find(r=>r.state==='ACTIVE')!;
 assert.throws(()=>setBatteryService(d,rented.batteryId!,'MAINTENANCE'),/en location/);
});

test('the real cabinet can leave the demo station for a fresh one — the only way to give it a clean local inventory',async()=>{
 const d=seedData('x');
 d.stations.push({id:'real',publicId:'bar-1',venueId:d.venues[0].id,partnerId:d.stations[0].partnerId,online:true,failure:'none',capacity:2});
 d.slots.push({id:'r1',stationId:'real',position:1,batteryId:null},{id:'r2',stationId:'real',position:2,batteryId:null});
 const link=linkManufacturerStation(d,'station-paris','BAJIE','DTA55480',1_000);
 // Seeded demo rentals are still open: moving the cabinet under them would corrupt their bookkeeping.
 assert.throws(()=>moveManufacturerLink(d,'BAJIE','DTA55480','real',2_000),/locations sont en cours/);
 assert.equal(d.stationProviderLinks.find(l=>l.id===link.id)!.stationId,'station-paris','a refused move changes nothing');
 for(const r of d.rentals)if(['ACTIVE','OVERDUE','EJECTION_FAILED'].includes(r.state))r.state='COMPLETED';
 // Unlike seed data, a plain state flip is enough here: only the guard under test is exercised.
 const result=moveManufacturerLink(d,'BAJIE','DTA55480','real',3_000);
 assert.equal(result.fromStationId,'station-paris');
 assert.equal(d.stationProviderLinks.filter(l=>l.externalId==='DTA55480').length,1,'one row per cabinet, exactly what the database unique index demands');
 assert.equal(d.stationProviderLinks[0].stationId,'real');
 const paris=d.stations.find(s=>s.id==='station-paris')!,real=d.stations.find(s=>s.id==='real')!;
 assert.equal(paris.providerDeviceId??null,null);assert.equal(paris.provider,'mock','the demo station no longer claims a real cabinet');
 assert.equal(real.providerDeviceId,'DTA55480');assert.equal(real.provider,'manufacturer');
 assert.equal(d.stationProviderSnapshots.length,0,'stale measurements of the old station are dropped');
 assert.throws(()=>moveManufacturerLink(d,'BAJIE','UNKNOWN','real'),/aucune station/);
 assert.throws(()=>moveManufacturerLink(d,'BAJIE','DTA55480','nowhere'),/cible introuvable/);
});
