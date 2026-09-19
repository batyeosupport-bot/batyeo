import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData,type Data} from '../core/types';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {adoptProviderInventory,INVENTORY_SNAPSHOT_MAX_AGE_MS} from '../core/station-admin';
import {linkManufacturerStation,ManufacturerSyncService} from '../core/manufacturer-sync';
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
