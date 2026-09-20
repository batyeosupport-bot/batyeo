import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {emptyData,type Data} from '../core/types';
import type {Repository} from '../core/repository';
import type {ManufacturerDeviceSnapshot} from '../core/manufacturer';
import {ManufacturerError} from '../core/manufacturer';
import {ManufacturerSyncService,linkManufacturerStation,providerHealth,compareManufacturerSnapshot,detectReturns,RETURN_SETTLE_MS} from '../core/manufacturer-sync';
import {RentalEngine} from '../core/rental';
import {dashboard} from '../core/queries';
import {createApi} from '../server/http';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(data:Data)=>T){const next=structuredClone(this.data),value=fn(next);validateData(next);this.data=next;return value;}}
const snapshot=(deviceId:string,online=true):ManufacturerDeviceSnapshot=>({deviceId,cabinetId:'cabinet',qrCode:'qr',online,totalSlots:4,emptySlots:1,busySlots:99,signal:'documented-value',type:'cabinet-type',ip:'10.0.0.1',shopId:'shop',shopName:'Demo',shopAddress:'Demo',latitude:null,longitude:null,batteries:[{id:'BAT-UNKNOWN',slot:1,voltage:4100}],slots:[{position:1,battery:{id:'BAT-UNKNOWN',slot:1,voltage:4100}},{position:2,battery:null},{position:3,battery:null},{position:4,battery:null}],availability:1,lastSeenAt:null});

test('compareManufacturerSnapshot flags a battery missing from the provider as unexplained only when no BATYEO rental accounts for it',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});d.stations.push({id:'s',publicId:'s',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:1});d.slots.push({id:'slot-1',stationId:'s',position:1,batteryId:'bat-1'});d.batteries.push({id:'bat-1',charge:100,status:'AVAILABLE'});
 const link=linkManufacturerStation(d,'s','BAJIE','EXT-1',100);
 const emptySnapshot:ManufacturerDeviceSnapshot={deviceId:'EXT-1',cabinetId:'c',qrCode:'qr',online:true,totalSlots:1,emptySlots:1,busySlots:0,signal:'x',type:'t',ip:'1.1.1.1',shopId:'shop',shopName:'n',shopAddress:'a',latitude:null,longitude:null,batteries:[],slots:[{position:1,battery:null}],availability:0,lastSeenAt:null};
 const withoutRental=compareManufacturerSnapshot(d,link,emptySnapshot,100_000);
 assert.ok(withoutRental.some(x=>x.kind==='UNEXPLAINED_SLOT_CHANGE'&&x.local==='bat-1'));
 assert.ok(withoutRental.some(x=>x.kind==='MISSING_BATTERY'&&x.local==='bat-1'));
 d.rentals.push({id:'r1',customerId:'c',partnerId:'p',stationId:'s',batteryId:'bat-1',returnStationId:null,state:'ACTIVE',paymentState:'AUTHORIZED',physicalState:'EJECTED',createdAt:99_000,startedAt:99_000,returnedAt:null,deadline:null,pricing:{id:'pr',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000},amountCents:0,commissionCents:0,idempotencyKey:'k',error:null,simulatedMinutes:0});
 const withRental=compareManufacturerSnapshot(d,link,emptySnapshot,100_000);
 assert.ok(!withRental.some(x=>x.kind==='UNEXPLAINED_SLOT_CHANGE'));
 assert.ok(withRental.some(x=>x.kind==='MISSING_BATTERY'));
});
test('manufacturer mapping prevents duplicate external IDs and supports provider registry',()=>{const data=seedData('x');const first=linkManufacturerStation(data,'station-paris','BAJIE','BJH02347',100);assert.equal(first.externalId,'BJH02347');assert.throws(()=>linkManufacturerStation(data,'station-lyon','BAJIE','BJH02347',101),/déjà associé/);validateData(data);});

test('read-only station sync persists normalized telemetry and reconciliation without overwriting BATYEO state',async()=>{const data=seedData('x');data.stations[0].online=false;linkManufacturerStation(data,'station-paris','BAJIE','BJH02347',100);const repo=new MemoryRepository(data),service=new ManufacturerSyncService(repo,{getDeviceInfo:async id=>snapshot(id,true)},{now:()=>200});const run=await service.run({trigger:'MANUAL'});assert.equal(run.status,'COMPLETED');assert.equal(repo.data.stations[0].online,false);assert.equal(repo.data.stations[0].providerStatus,'ONLINE');assert.equal(repo.data.stationProviderSnapshots[0].busySlots,99);assert.ok(repo.data.reconciliationRecords.some(row=>row.kind==='STATION_STATUS'&&row.status==='OPEN'));assert.ok(repo.data.reconciliationRecords.some(row=>row.kind==='UNKNOWN_BATTERY'));});

test('sync retries safe reads and continues when another station fails',async()=>{const data=seedData('x');linkManufacturerStation(data,'station-paris','BAJIE','OK',100);linkManufacturerStation(data,'station-lyon','BAJIE','FAIL',100);const attempts=new Map<string,number>(),repo=new MemoryRepository(data);const service=new ManufacturerSyncService(repo,{getDeviceInfo:async id=>{attempts.set(id,(attempts.get(id)??0)+1);if(id==='FAIL')throw new ManufacturerError('timeout',504,'TIMEOUT');if((attempts.get(id)??0)<2)throw new ManufacturerError('temporary',503,'UNAVAILABLE');return snapshot(id);}},{attempts:2,baseDelayMs:0,sleep:async()=>{}});const run=await service.run({trigger:'SCHEDULED'});assert.equal(run.status,'PARTIAL');assert.equal(run.succeeded,1);assert.equal(run.failed,1);assert.equal(attempts.get('OK'),2);assert.equal(attempts.get('FAIL'),2);});
test('scheduler lock rejects a concurrent second run and health uses only sync signals',async()=>{const data=seedData('x');linkManufacturerStation(data,'station-paris','BAJIE','LOCK',100);const repo=new MemoryRepository(data);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let calls=0;const service=new ManufacturerSyncService(repo,{getDeviceInfo:async id=>{calls++;await gate;return snapshot(id);}},{now:()=>100,lockMs:60_000});const first=service.run({trigger:'SCHEDULED'});await new Promise(resolve=>setTimeout(resolve,0));const second=await service.run({trigger:'SCHEDULED'});assert.equal(second.skipped,true);release();const completed=await first;assert.equal(completed.status,'COMPLETED');assert.equal(calls,1);assert.equal(providerHealth(repo.data,100).status,'DEGRADED');});

test('partner dashboard cannot see another tenant manufacturer records',()=>{const data=seedData('x');const link=linkManufacturerStation(data,'station-paris','BAJIE','PARIS',100);data.reconciliationRecords.push({id:'rec',stationId:'station-paris',linkId:link.id,kind:'AVAILABILITY',position:null,localValue:2,providerValue:1,status:'OPEN',firstDetectedAt:100,lastDetectedAt:100,resolvedAt:null});const partnerB=dashboard(data,{id:'partner-b-demo',role:'PARTNER_ADMIN',partnerId:'partner-b'});assert.equal(partnerB.providerLinks.length,0);assert.equal(partnerB.reconciliationRecords.length,0);assert.equal(partnerB.manufacturerHealth.status,'UNKNOWN');});

test('manufacturer webhook is deduplicated, untrusted and only changes state after read-only reconciliation',async()=>{const data=seedData('x');linkManufacturerStation(data,'station-paris','BAJIE','BJH02347',100);const repo=new MemoryRepository(data),provider={getDeviceInfo:async(id:string)=>snapshot(id),listDevices:async()=>[]};const api=createApi(repo,{demo:true,allowLegacyCredentials:true},{manufacturerProvider:provider});const make=()=>new Request('https://batyeo.test/api/core/manufacturer/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({documentedShape:false,value:1})});const first=await api.POST(make(),{params:Promise.resolve({path:['manufacturer','webhook']})});assert.equal(first.status,202);assert.equal(repo.data.webhookEvents[0].status,'PROCESSED');assert.ok(repo.data.webhookEvents[0].source.startsWith('manufacturer:'));const second=await api.POST(make(),{params:Promise.resolve({path:['manufacturer','webhook']})});assert.equal((await second.json() as {duplicate:boolean}).duplicate,true);assert.equal(repo.data.webhookEvents.length,1);});
test('internal scheduler trigger is denied without secret and runs read-only with bearer secret',async()=>{const data=seedData('x');linkManufacturerStation(data,'station-paris','BAJIE','BJH02347',100);const repo=new MemoryRepository(data),provider={getDeviceInfo:async(id:string)=>snapshot(id),listDevices:async()=>[]},previous=process.env.MANUFACTURER_SYNC_SECRET;process.env.MANUFACTURER_SYNC_SECRET='staging-secret';try{const api=createApi(repo,{demo:false,allowLegacyCredentials:false},{manufacturerProvider:provider});const request=(secret?:string)=>new Request('https://batyeo.test/api/core/internal/manufacturer/sync',{method:'POST',headers:secret?{authorization:`Bearer ${secret}`}:{}});const denied=await api.POST(request('wrong'),{params:Promise.resolve({path:['internal','manufacturer','sync']})});assert.equal(denied.status,401);const accepted=await api.POST(request('staging-secret'),{params:Promise.resolve({path:['internal','manufacturer','sync']})});assert.equal(accepted.status,200);assert.equal(repo.data.manufacturerSyncRuns[0].trigger,'SCHEDULED');}finally{if(previous===undefined)delete process.env.MANUFACTURER_SYNC_SECRET;else process.env.MANUFACTURER_SYNC_SECRET=previous;}});

const snapshotHolding=(deviceId:string,batteryId:string):ManufacturerDeviceSnapshot=>{const base=snapshot(deviceId);return {...base,batteries:[{id:batteryId,slot:1,voltage:4100}],slots:[{position:1,battery:{id:batteryId,slot:1,voltage:4100}},...base.slots.slice(1)]};};
const rentedFixture=()=>{const data=seedData('x');const link=linkManufacturerStation(data,'station-paris','BAJIE','RET-1',100);const engine=new RentalEngine();const rental=engine.start(data,'cust-1','station-paris','k-1',1_000);assert.equal(rental.state,'ACTIVE');return {data,link,engine,rental};};

test('detectReturns only flags an open rental whose battery is physically back in a slot after the settle window',()=>{
 const {data,link,rental}=rentedFixture();const back=snapshotHolding('RET-1',rental.batteryId!);
 assert.deepEqual(detectReturns(data,link,back,1_000+RETURN_SETTLE_MS),[{rentalId:rental.id,stationId:'station-paris'}]);
 assert.deepEqual(detectReturns(data,link,back,1_000+RETURN_SETTLE_MS-1),[]);
 assert.deepEqual(detectReturns(data,link,snapshot('RET-1'),1_000+RETURN_SETTLE_MS),[]);
 data.rentals.find(r=>r.id===rental.id)!.state='COMPLETED';assert.deepEqual(detectReturns(data,link,back,1_000+RETURN_SETTLE_MS),[]);
});

test('a sync that sees the rented battery back in a slot closes the rental from the manufacturer read, not from the customer',async()=>{
 const {data,rental,engine}=rentedFixture();const repo=new MemoryRepository(data);const at=1_000+10*60_000;
 const service=new ManufacturerSyncService(repo,{getDeviceInfo:async id=>snapshotHolding(id,rental.batteryId!)},{now:()=>at,onReturnDetected:(c,now)=>repo.transaction(d=>engine.return(d,c.rentalId,c.stationId,now,true))});
 await service.run({trigger:'WEBHOOK'});
 const closed=repo.data.rentals.find(r=>r.id===rental.id)!;
 assert.equal(closed.state,'COMPLETED');assert.equal(closed.returnStationId,'station-paris');assert.equal(closed.returnedAt,at);assert.ok(closed.amountCents>0);
 assert.ok(repo.data.events.some(e=>e.rentalId===rental.id&&e.detail==='Retour confirmé par relecture fabricant'));
 assert.equal(repo.data.batteries.find(b=>b.id===rental.batteryId)!.status,'AVAILABLE');
 const again=await service.run({trigger:'WEBHOOK'});assert.equal(again.status,'COMPLETED');assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.returnedAt,at);
});

test('a failing close handler never marks the station sync as failed and leaves the rental open',async()=>{
 const {data,rental}=rentedFixture();const repo=new MemoryRepository(data);const logs:string[]=[];
 const service=new ManufacturerSyncService(repo,{getDeviceInfo:async id=>snapshotHolding(id,rental.batteryId!)},{now:()=>1_000+10*60_000,logger:e=>logs.push(e.event),onReturnDetected:async()=>{throw new Error('boom');}});
 const run=await service.run({trigger:'SCHEDULED'});
 assert.equal(run.status,'COMPLETED');assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'ACTIVE');assert.ok(logs.includes('manufacturer_return_close_failed'));
});

test('a return confirmed by the cabinet closes the rental even when local bookkeeping disagrees — a stranded rental would bill the full deposit at 48 h',()=>{
 for(const [label,sabotage] of [
  ['station marquée hors ligne localement',(d:Data)=>{d.stations.find(s=>s.id==='station-lyon')!.online=false;}],
  ['aucun slot libre côté BATYEO',(d:Data)=>{let n=0;for(const slot of d.slots.filter(s=>s.stationId==='station-lyon'&&!s.batteryId)){const id=`FILL-${++n}`;d.batteries.push({id,charge:100,status:'AVAILABLE'});slot.batteryId=id;}}],
 ] as [string,(d:Data)=>void][]){
  const d=seedData('x'),engine=new RentalEngine();
  const rental=engine.start(d,'cust-drift','station-paris','k-drift',1_000);
  assert.equal(rental.state,'ACTIVE',label);
  sabotage(d);
  const closed=engine.return(d,rental.id,'station-lyon',2_000,true);
  assert.equal(closed.state,'COMPLETED',label);
  assert.equal(d.batteries.find(b=>b.id===rental.batteryId)!.status,'AVAILABLE',label);
  assert.equal(d.slots.filter(s=>s.batteryId===rental.batteryId).length,1,`${label} — exactement un slot, jamais deux`);
  validateData(d);
 }
});

test('a cabinet-confirmed return puts the battery back at the station that physically holds it',()=>{
 const d=seedData('x'),engine=new RentalEngine();
 const rental=engine.start(d,'cust-cross','station-paris','k-cross',1_000);
 engine.return(d,rental.id,'station-lyon',2_000,true);
 assert.equal(d.slots.find(s=>s.batteryId===rental.batteryId)!.stationId,'station-lyon');
 validateData(d);
});
