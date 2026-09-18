import test from 'node:test';
import assert from 'node:assert/strict';
import {ManufacturerApiError,ManufacturerBatteryEjector,ManufacturerBatteryStationProvider,ManufacturerError,ManufacturerHttpClient,applyManufacturerStationTelemetry,reconcileManufacturerStation,resolveManufacturerConfig,validateManufacturerStartup,type ManufacturerOperationType,type ManufacturerTransport} from '../core/manufacturer';
import {MANUFACTURER_OPERATION_TYPES} from '../core/manufacturer';
import {DomainError,MockBatteryStationProvider,PhysicalResultUnknownError} from '../core/providers';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {sha256} from '../core/security';
import {createApi} from '../server/http';
import type {Data} from '../core/types';
import type {Repository} from '../core/repository';

const config={baseUrl:'https://developer.chargenow.top/cdb-open-api/v1',username:'user',password:'pass',allowPhysicalActions:false as const};
// Only the tests that assert the cabinet/operation wire contract opt in; everything else must
// keep working — and keep refusing physical calls — on the read-only config above.
const physicalConfig={...config,allowPhysicalActions:true as const};
const deviceFixture={msg:'success',code:0,unknownRoot:'accepted',data:{priceStrategy:{depositAmount:20,priceMinute:2,autoRefund:1,timeoutAmount:0,timeoutDay:2,dailyMaxPrice:8,freeMinutes:0,currencySymbol:'€',price:2,name:'demo',currency:'EUR',shopId:'shop-1'},shop:{address:'1 rue Démo',priceMinute:'2',city:'Paris',dailyMaxPrice:8,latitude:'48.8566',openingTime:'24/7',freeMinutes:0,icon:'',content:'',province:'',price:2,name:'Hôtel Démo',deposit:20,logo:'',id:'shop-1',region:'',longitude:'2.3522'},batteries:[{slotNum:1,vol:4100,batteryId:'BAT-M-1',futureField:true},{slotNum:3,vol:4050,batteryId:'BAT-M-2'}],cabinet:{ip:'10.0.0.1',remark:'',type:'8-slot',slots:4,qrCode:'QR-DEMO',online:true,emptySlots:1,busySlots:1,id:'cabinet-1',shopId:'shop-1',signal:'good',posDeviceId:''}}};
const listFixture={msg:'success',code:0,list:[{price:{priceId:1,freeDuration:'0',price:'2',chargeUnit:'hour',dailyCapAmount:'8',deposit:'20'},cabinet:{batteryNum:'2',freeNum:'1',infoStatus:'online'},shop:{id:'shop-1',shopName:'Hôtel Démo',shopAddress:'1 rue Démo',mobile:'',distance:'10m',longitude:'2.3522',latitude:'48.8566',shopBanner:'',shopIcon:'',distanceNumber:10,sceneType:'hotel'},unknown:true}]};
const json=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(data:Data)=>T){const next=structuredClone(this.data),value=fn(next);validateData(next);this.data=next;return value;}}

test('manufacturer device info uses the documented endpoint/auth and maps station, slots and batteries',async()=>{let request:{url:string;init:RequestInit}|undefined;const transport:ManufacturerTransport=async(url,init)=>{request={url,init};return json(deviceFixture);};const snapshot=await new ManufacturerHttpClient(config,transport).getDeviceInfo({deviceId:'BJH02347'});assert.equal(new URL(request!.url).pathname,'/cdb-open-api/v1/rent/cabinet/query');assert.equal(new URL(request!.url).searchParams.get('deviceId'),'BJH02347');assert.equal(request!.init.method,'GET');assert.equal((request!.init.headers as Record<string,string>).Authorization,'Basic dXNlcjpwYXNz');assert.equal(snapshot.cabinetId,'cabinet-1');assert.equal(snapshot.online,true);assert.equal(snapshot.totalSlots,4);assert.equal(snapshot.availability,2);assert.equal(snapshot.slots[0].battery?.id,'BAT-M-1');assert.equal(snapshot.slots[1].battery,null);assert.equal(snapshot.batteries[0].voltage,4100);assert.equal(snapshot.lastSeenAt,null);});
test('a real DTA55480 cabinet/query response, confirmed live on 2026-09-18, parses even though shop.address is entirely absent',async()=>{
 // Captured against the real Open API with live merchant credentials, values kept as observed
 // except the device/shop ids and battery serials, which are not needed to reproduce the shape.
 // Unlike city/openingTime/icon in the same payload, address isn't sent as '' when unset — it's
 // missing outright, which the documented shape (see deviceFixture above) does not show.
 const realShape={msg:'Successful operation',code:0,data:{priceStrategy:{depositAmount:30,priceMinute:60,autoRefund:0,timeoutAmount:50,timeoutDay:3,dailyMaxPrice:10,freeMinutes:10,currencySymbol:'€',price:1,name:'Real Merchant',currency:'EUR',shopId:''},shop:{priceMinute:'60',city:'',dailyMaxPrice:10,latitude:'48.7461920999',openingTime:'',freeMinutes:10,icon:'',content:'',province:'',price:1,name:'Real Merchant',deposit:30,logo:'',id:'shop-real',region:'',longitude:'2.1131622'},batteries:[{slotNum:1,vol:100,batteryId:'BAT-REAL-1'},{slotNum:2,vol:99,batteryId:'BAT-REAL-2'}],cabinet:{ip:'37.67.104.48',remark:' ',posOnlineStatus:'offline',type:'8',slots:8,qrCode:'QR-REAL',online:true,emptySlots:6,busySlots:2,id:'DTA55480',shopId:'shop-real',signal:'73',posDeviceId:''}}};
 assert.ok(!('address' in realShape.data.shop));
 const snapshot=await new ManufacturerHttpClient(config,async()=>json(realShape)).getDeviceInfo({deviceId:'DTA55480'});
 assert.equal(snapshot.shopAddress,'');
 assert.equal(snapshot.cabinetId,'DTA55480');
 assert.equal(snapshot.totalSlots,8);
});
test('MANUFACTURER_OPERATION_TYPES matches the 10 values confirmed on the official Apifox docs for cabinet/operation on 2026-09-18',()=>{
 assert.deepEqual([...MANUFACTURER_OPERATION_TYPES],['restart','pop','popall','popallForNoAuth','popallForAuth','heartbeat','lock','unlock','lockStopCharge','report']);
});
test('operateDevice calls the confirmed cabinet/operation endpoint with Basic auth and the documented parameters',async()=>{
 let request:{url:string;init:RequestInit}|undefined;
 const transport:ManufacturerTransport=async(url,init)=>{request={url,init};return json({msg:'success',code:0});};
 const result=await new ManufacturerHttpClient(physicalConfig,transport).operateDevice({cabinetId:'DTA55480',slotNum:2,operationType:'pop'});
 const url=new URL(request!.url);
 assert.equal(url.pathname,'/cdb-open-api/v1/cabinet/operation');
 assert.equal(url.searchParams.get('cabinetid'),'DTA55480');
 assert.equal(url.searchParams.get('slotNum'),'2');
 assert.equal(url.searchParams.get('operationType'),'pop');
 assert.equal(url.searchParams.get('reason'),'');
 assert.equal(request!.init.method,'POST');
 assert.equal((request!.init.headers as Record<string,string>).Authorization,'Basic dXNlcjpwYXNz');
 assert.equal(result.code,0);
});
test('operateDevice surfaces a non-zero response code as a typed provider error, never as success',async()=>{
 const client=new ManufacturerHttpClient(physicalConfig,async()=>json({msg:'Device offline',code:1001}));
 await assert.rejects(()=>client.operateDevice({cabinetId:'DTA55480',slotNum:1,operationType:'pop'}),(error:unknown)=>error instanceof ManufacturerApiError&&error.providerCode===1001);
});
test('ManufacturerBatteryEjector picks the best-charged slot from a live cabinet/query, pops it, and returns that battery id',async()=>{
 const data=seedData('unused');data.stationProviderLinks.push({id:'link-1',stationId:'station-paris',manufacturer:'BAJIE',externalId:'BJH02347',active:true,createdAt:0,updatedAt:0});
 const repo=new MemoryRepository(data);let operateCall:{cabinetId:string;slotNum:number;operationType:string}|undefined;
 const client={getDeviceInfo:async()=>new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'BJH02347'}),operateDevice:async(query:{cabinetId:string;slotNum:number;operationType:ManufacturerOperationType})=>{operateCall=query;return {code:0,msg:'success'};}};
 const battery=await new ManufacturerBatteryEjector(client,repo).ejectBatteryAsync('station-paris');
 assert.equal(battery,'BAT-M-1');// slot 1 · 4100 mV beats slot 3 · 4050 mV
 assert.deepEqual(operateCall,{cabinetId:'BJH02347',slotNum:1,operationType:'pop',reason:'BATYEO rental'});
});
test('ManufacturerBatteryEjector refuses a station with no manufacturer link, an offline cabinet, or an empty cabinet',async()=>{
 const unlinked=seedData('unused');const client={getDeviceInfo:async()=>new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'x'}),operateDevice:async()=>({code:0,msg:'success'})};
 await assert.rejects(()=>new ManufacturerBatteryEjector(client,new MemoryRepository(unlinked)).ejectBatteryAsync('station-paris'),(error:unknown)=>error instanceof DomainError&&error.status===503);
 const offline=seedData('unused');offline.stationProviderLinks.push({id:'link-1',stationId:'station-paris',manufacturer:'BAJIE',externalId:'BJH02347',active:true,createdAt:0,updatedAt:0});
 const offlineClient={getDeviceInfo:async()=>new ManufacturerHttpClient(config,async()=>json({...deviceFixture,data:{...deviceFixture.data,cabinet:{...deviceFixture.data.cabinet,online:false}}})).getDeviceInfo({deviceId:'BJH02347'}),operateDevice:async()=>({code:0,msg:'success'})};
 await assert.rejects(()=>new ManufacturerBatteryEjector(offlineClient,new MemoryRepository(offline)).ejectBatteryAsync('station-paris'),(error:unknown)=>error instanceof DomainError&&error.status===503);
 const empty=seedData('unused');empty.stationProviderLinks.push({id:'link-1',stationId:'station-paris',manufacturer:'BAJIE',externalId:'BJH02347',active:true,createdAt:0,updatedAt:0});
 const emptyFixture={...deviceFixture,data:{...deviceFixture.data,batteries:[]}};
 const emptyClient={getDeviceInfo:async()=>new ManufacturerHttpClient(config,async()=>json(emptyFixture)).getDeviceInfo({deviceId:'BJH02347'}),operateDevice:async()=>({code:0,msg:'success'})};
 await assert.rejects(()=>new ManufacturerBatteryEjector(emptyClient,new MemoryRepository(empty)).ejectBatteryAsync('station-paris'),(error:unknown)=>error instanceof DomainError&&error.status===409);
});
test('ManufacturerBatteryEjector treats a confirmed provider error as a definite failure but a timeout as an unknown physical result',async()=>{
 const data=seedData('unused');data.stationProviderLinks.push({id:'link-1',stationId:'station-paris',manufacturer:'BAJIE',externalId:'BJH02347',active:true,createdAt:0,updatedAt:0});
 const withDeviceInfo=(operateDevice:()=>Promise<{code:number;msg:string}>)=>({getDeviceInfo:async()=>new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'BJH02347'}),operateDevice});
 const confirmedFailure=withDeviceInfo(async()=>{throw new ManufacturerApiError(1001,'Device offline');});
 await assert.rejects(()=>new ManufacturerBatteryEjector(confirmedFailure,new MemoryRepository(structuredClone(data))).ejectBatteryAsync('station-paris'),(error:unknown)=>error instanceof ManufacturerApiError&&error.providerCode===1001);
 const uncertain=withDeviceInfo(async()=>{throw new ManufacturerError('Délai de réponse fabricant dépassé.',504,'TIMEOUT');});
 await assert.rejects(()=>new ManufacturerBatteryEjector(uncertain,new MemoryRepository(structuredClone(data))).ejectBatteryAsync('station-paris'),(error:unknown)=>error instanceof PhysicalResultUnknownError);
});
test('manufacturer device list uses only documented query parameters and maps summaries',async()=>{let called='';const client=new ManufacturerHttpClient(config,async url=>{called=url;return json(listFixture);});const rows=await client.listDevices({coordType:'GCJ-02',zoomLevel:5,lat:22.989442,lng:113.327761,showPrice:true});const url=new URL(called);assert.equal(url.pathname,'/cdb-open-api/v1/rent/cabinet/list');assert.deepEqual([...url.searchParams.keys()],['coordType','zoomLevel','lat','lng','showPrice']);assert.deepEqual(rows,[{shopId:'shop-1',name:'Hôtel Démo',address:'1 rue Démo',latitude:48.8566,longitude:2.3522,batteryCount:2,freeCount:1,informationStatus:'online'}]);});
test('manufacturer timeout, auth, malformed and unavailable errors are typed',async()=>{const timeoutClient=new ManufacturerHttpClient({...config,timeoutMs:5},async(_url,init)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));await assert.rejects(()=>timeoutClient.getDeviceInfo({deviceId:'x'}),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='TIMEOUT');for(const [response,kind] of [[new Response('',{status:401}),'AUTH'],[new Response('{',{status:200}),'MALFORMED'],[json({code:0,msg:'ok',data:{}}),'MALFORMED'],[new Response('',{status:503}),'UNAVAILABLE']] as const){const client=new ManufacturerHttpClient(config,async()=>response);await assert.rejects(()=>client.getDeviceInfo({deviceId:'x'}),(error:unknown)=>error instanceof ManufacturerError&&error.kind===kind);}});
test('provider code 2002 is preserved without assigning an undocumented meaning',async()=>{const client=new ManufacturerHttpClient(config,async()=>json({...deviceFixture,code:2002,msg:'QR code unbound device.'}));await assert.rejects(()=>client.getDeviceInfo({deviceId:'BJH02347'}),(error:unknown)=>error instanceof ManufacturerApiError&&error.providerCode===2002&&error.message==='QR code unbound device.');});
// A real DTA55480 error response, confirmed live on 2026-09-18: unlike the fixture above (which
// keeps `data` present for convenience), the true shape carries no `data` at all on a non-zero
// code — surfaced as ManufacturerError('Réponse fabricant mal formée.') before this fix, since
// deviceResponseSchema required `data` and was validated before the code was even inspected.
test('a real "device not online" error response, with no data field at all, surfaces the provider code instead of MALFORMED',async()=>{const client=new ManufacturerHttpClient(config,async()=>json({msg:'Device not online.',code:2004}));await assert.rejects(()=>client.getDeviceInfo({deviceId:'DTA55480'}),(error:unknown)=>error instanceof ManufacturerApiError&&error.providerCode===2004&&error.message==='Device not online.');});
test('a list response with a non-zero code and no list field surfaces the provider code instead of MALFORMED',async()=>{const client=new ManufacturerHttpClient(config,async()=>json({msg:'Invalid coordinates.',code:3001}));await assert.rejects(()=>client.listDevices({coordType:'GCJ-02',zoomLevel:5,lat:0,lng:0,showPrice:false}),(error:unknown)=>error instanceof ManufacturerApiError&&error.providerCode===3001);});
test('manufacturer provider is read-only and shares the local read contract with the mock',()=>{const data=seedData('unused');data.stations[0].providerDeviceId='BJH02347';const manufacturer=new ManufacturerBatteryStationProvider(new ManufacturerHttpClient(config,async()=>json(deviceFixture)));const mock=new MockBatteryStationProvider();assert.equal(manufacturer.getStation(data,'BJH02347').id,mock.getStation(data,'station-paris').id);assert.equal(manufacturer.getAvailability(data,'BJH02347'),mock.getAvailability(data,'station-paris'));assert.throws(()=>manufacturer.ejectBattery(data,'station-paris'),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');assert.throws(()=>manufacturer.returnBattery(data,'station-paris','BAT-X'));assert.throws(()=>manufacturer.setOnline(data,'station-paris',false));});
test('manufacturer reconciliation detects online, capacity, availability and slot differences',async()=>{const data=seedData('unused');const local=data.stations[0];local.online=false;const snapshot=await new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'BJH02347'});const kinds=reconcileManufacturerStation(data,local,snapshot).map(d=>d.kind);assert.ok(kinds.includes('ONLINE_STATUS'));assert.ok(kinds.includes('CAPACITY'));assert.ok(kinds.includes('AVAILABILITY'));assert.ok(kinds.includes('SLOT_BATTERY'));});
test('manufacturer telemetry sync updates only safe station fields',async()=>{const data=seedData('unused');const snapshot=await new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'BJH02347'});const beforeSlots=structuredClone(data.slots);const result=applyManufacturerStationTelemetry(data,'station-paris',snapshot,1234);assert.equal(result.station.provider,'manufacturer');assert.equal(result.station.providerDeviceId,'BJH02347');assert.equal(result.station.providerLastSyncedAt,1234);assert.equal(result.station.lastSeenAt,undefined);assert.deepEqual(data.slots,beforeSlots);});
test('manufacturer configuration is optional, complete and read-only unless explicitly opted in',()=>{assert.equal(resolveManufacturerConfig({}),undefined);const bajie={MANUFACTURER_PROVIDER:'bajie',MANUFACTURER_API_BASE_URL:config.baseUrl,MANUFACTURER_USERNAME:'user',MANUFACTURER_PASSWORD:'pass'};assert.equal(resolveManufacturerConfig(bajie)?.baseUrl,config.baseUrl);assert.equal(resolveManufacturerConfig(bajie)?.allowPhysicalActions,false);assert.throws(()=>resolveManufacturerConfig({MANUFACTURER_USERNAME:'user',MANUFACTURER_PASSWORD:'pass'}));assert.throws(()=>resolveManufacturerConfig({MANUFACTURER_PROVIDER:'bajie',MANUFACTURER_USERNAME:'user'}));
 assert.equal(resolveManufacturerConfig({...bajie,MANUFACTURER_ALLOW_PHYSICAL_ACTIONS:'true'})?.allowPhysicalActions,true);
 // Physical actions without a real provider behind them, and any value that is not exactly
 // 'true'/'false', both fail closed rather than being guessed at.
 assert.throws(()=>resolveManufacturerConfig({MANUFACTURER_ALLOW_PHYSICAL_ACTIONS:'true'}),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');
 for(const ambiguous of ['1','yes','TRUE','True',' true','on'])assert.throws(()=>resolveManufacturerConfig({...bajie,MANUFACTURER_ALLOW_PHYSICAL_ACTIONS:ambiguous}),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');
});
test('operateDevice is refused unless physical actions were explicitly opted in, while reads keep working',async()=>{
 const blocked=new ManufacturerHttpClient(config,async()=>json({msg:'success',code:0}));
 await assert.rejects(()=>blocked.operateDevice({cabinetId:'DTA55480',slotNum:1,operationType:'pop'}),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');
 // The gate sits on the physical call only: monitoring must never depend on it.
 const snapshot=await new ManufacturerHttpClient(config,async()=>json(deviceFixture)).getDeviceInfo({deviceId:'BJH02347'});
 assert.equal(snapshot.totalSlots,4);
});
test('real ejections are refused at startup in mock payment mode, which cannot drive real hardware',()=>{
 const enabled={MANUFACTURER_PROVIDER:'bajie',MANUFACTURER_API_BASE_URL:config.baseUrl,MANUFACTURER_USERNAME:'user',MANUFACTURER_PASSWORD:'pass',MANUFACTURER_ALLOW_PHYSICAL_ACTIONS:'true',MANUFACTURER_SYNC_SECRET:'secret'};
 assert.throws(()=>validateManufacturerStartup({...enabled,PAYMENT_PROVIDER:'mock'}),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');
 assert.throws(()=>validateManufacturerStartup(enabled),(error:unknown)=>error instanceof ManufacturerError&&error.kind==='PHYSICAL_BLOCKED');// defaults to mock
 assert.equal(validateManufacturerStartup({...enabled,PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_test_x'})?.allowPhysicalActions,true);
});
test('startup validation requires a scheduler secret only when Bajie is enabled',()=>{assert.throws(()=>validateManufacturerStartup({MANUFACTURER_PROVIDER:'bajie',MANUFACTURER_API_BASE_URL:config.baseUrl,MANUFACTURER_USERNAME:'user',MANUFACTURER_PASSWORD:'pass'}));assert.equal(validateManufacturerStartup({MANUFACTURER_PROVIDER:'disabled'}),undefined);assert.equal(validateManufacturerStartup({}),undefined);});
test('admin provider endpoint exposes only mapped data and keeps tenant isolation',async()=>{const data=seedData('unused');data.stations[0].providerDeviceId='BJH02347';data.stations[2].providerDeviceId='OTHER';const adminToken='a'.repeat(64),partnerToken='p'.repeat(64);data.sessions.push({id:await sha256(adminToken),userId:'admin-demo',expiresAt:Date.now()+60_000,authVersion:0},{id:await sha256(partnerToken),userId:'partner-demo',expiresAt:Date.now()+60_000,authVersion:0});const repo=new MemoryRepository(data);const client=new ManufacturerHttpClient(config,async()=>json(deviceFixture));const provider=new ManufacturerBatteryStationProvider(client);const api=createApi(repo,{demo:true,allowLegacyCredentials:true},{manufacturerProvider:provider});const request=(station:string,token:string)=>new Request(`https://batyeo.test/api/core/manufacturer/stations/${station}`,{headers:{cookie:`batyeo_session=${token}`}});const ok=await api.GET(request('station-paris',adminToken),{params:Promise.resolve({path:['manufacturer','stations','station-paris']})});assert.equal(ok.status,200);const body=await ok.json() as {station:Record<string,unknown>};assert.equal(body.station.deviceId,'BJH02347');assert.equal('priceStrategy' in body.station,false);assert.equal((await api.GET(request('station-lille',partnerToken),{params:Promise.resolve({path:['manufacturer','stations','station-lille']})})).status,404);});
