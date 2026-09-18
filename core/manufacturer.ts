import {z} from 'zod';
import type {Data,Station} from './types';
import type {BatteryStationProvider} from './providers';
import {DomainError,PhysicalResultUnknownError} from './providers';
import {resolvePaymentMode} from './payment-mode';
import type {Repository} from './repository';

export const MANUFACTURER_DEFAULT_BASE_URL='https://developer.chargenow.top/cdb-open-api/v1';
export const MANUFACTURER_DEVICE_INFO_PATH='/rent/cabinet/query';
export const MANUFACTURER_DEVICE_LIST_PATH='/rent/cabinet/list';
/** Confirmed 2026-09-18 against the official Apifox docs (not the admin-panel-only cdb-web-api
 * mirror found earlier): same shape, same operationType values, public and Basic-authenticated. */
export const MANUFACTURER_DEVICE_OPERATION_PATH='/cabinet/operation';
export const MANUFACTURER_OPERATION_TYPES=['restart','pop','popall','popallForNoAuth','popallForAuth','heartbeat','lock','unlock','lockStopCharge','report'] as const;
export type ManufacturerOperationType=typeof MANUFACTURER_OPERATION_TYPES[number];

export class ManufacturerError extends DomainError {constructor(message:string,status=502,public readonly kind:'AUTH'|'TIMEOUT'|'UNAVAILABLE'|'MALFORMED'|'API'|'PHYSICAL_BLOCKED'='UNAVAILABLE'){super(message,status);}}
export class ManufacturerApiError extends ManufacturerError {constructor(public readonly providerCode:number,message:string){super(message,502,'API');}}
export interface ManufacturerLog {level:'info'|'warn'|'error';event:string;path:string;status?:number;providerCode?:number;}
export type ManufacturerLogger=(entry:ManufacturerLog)=>void;
export type ManufacturerTransport=(url:string,init:RequestInit)=>Promise<Response>;
export interface ManufacturerConfig {baseUrl:string;username:string;password:string;timeoutMs?:number;allowPhysicalActions?:boolean;}
export type ManufacturerEndpointAuth=(path:string)=>Record<string,string>;
export interface ManufacturerDeviceQuery {deviceId:string;}
export interface ManufacturerListQuery {coordType:string;zoomLevel:number;lat:number;lng:number;showPrice:boolean;}
export interface ManufacturerBatterySnapshot {id:string;slot:number;voltage:number;}
export interface ManufacturerSlotSnapshot {position:number;battery:ManufacturerBatterySnapshot|null;}
export interface ManufacturerDeviceSnapshot {deviceId:string;cabinetId:string;qrCode:string;online:boolean;totalSlots:number;emptySlots:number;busySlots:number;signal:string;type:string;ip:string;shopId:string;shopName:string;shopAddress:string;latitude:number|null;longitude:number|null;batteries:ManufacturerBatterySnapshot[];slots:ManufacturerSlotSnapshot[];availability:number;lastSeenAt:null;}
export interface ManufacturerStationSummary {shopId:string;name:string;address:string;latitude:number;longitude:number;batteryCount:number;freeCount:number;informationStatus:string;}
/** Future domain contract only. The endpoint behind operateDevice() below is now confirmed
 * (docs/EXTERNAL_BLOCKERS.md), but nothing in server/ or core/stripe-coordinator.ts calls it yet —
 * see ManufacturerHttpClient.operateDevice() and MANUFACTURER_ALLOW_PHYSICAL_ACTIONS. */
export interface ManufacturerPhysicalActions {eject(stationExternalId:string):Promise<void>;ejectSlot(stationExternalId:string,slot:number):Promise<void>;operateDevice(stationExternalId:string,operation:string):Promise<void>;}
export interface ManufacturerOperationQuery {cabinetId:string;slotNum:number;operationType:ManufacturerOperationType;reason?:string;}
export interface ManufacturerOperationResult {code:number;msg:string;}

const nonEmpty=z.string().min(1);
const batterySchema=z.object({slotNum:z.number().int().positive(),vol:z.number(),batteryId:nonEmpty}).passthrough();
const cabinetSchema=z.object({ip:z.string(),remark:z.string(),type:z.string(),slots:z.number().int().nonnegative(),qrCode:z.string(),online:z.boolean(),emptySlots:z.number().int().nonnegative(),busySlots:z.number().int().nonnegative(),id:nonEmpty,shopId:z.string(),signal:z.string(),posDeviceId:z.string()}).passthrough();
// address is optional: confirmed against a real DTA55480 query on 2026-09-18 that the field is
// entirely absent, not an empty string, when unset — unlike city/openingTime/icon in the same payload.
const shopSchema=z.object({address:z.string().optional().default(''),priceMinute:z.string(),city:z.string(),dailyMaxPrice:z.number(),latitude:z.string(),openingTime:z.string(),freeMinutes:z.number(),icon:z.string(),content:z.string(),province:z.string(),price:z.number(),name:z.string(),deposit:z.number(),logo:z.string(),id:z.string(),region:z.string(),longitude:z.string()}).passthrough();
const deviceResponseSchema=z.object({msg:z.string(),code:z.number().int(),data:z.object({priceStrategy:z.object({depositAmount:z.number(),priceMinute:z.number(),autoRefund:z.number(),timeoutAmount:z.number(),timeoutDay:z.number(),dailyMaxPrice:z.number(),freeMinutes:z.number(),currencySymbol:z.string(),price:z.number(),name:z.string(),currency:z.string(),shopId:z.string()}).passthrough(),shop:shopSchema,batteries:z.array(batterySchema),cabinet:cabinetSchema}).passthrough()}).passthrough();
const listItemSchema=z.object({price:z.object({priceId:z.number(),freeDuration:z.string(),price:z.string(),chargeUnit:z.string(),dailyCapAmount:z.string(),deposit:z.string()}).passthrough(),cabinet:z.object({batteryNum:z.string(),freeNum:z.string(),infoStatus:z.string()}).passthrough(),shop:z.object({id:z.string(),shopName:z.string(),shopAddress:z.string(),mobile:z.string(),distance:z.string(),longitude:z.string(),latitude:z.string(),shopBanner:z.string(),shopIcon:z.string(),distanceNumber:z.number(),sceneType:z.string()}).passthrough()}).passthrough();
// Response documented only as "RestResponse" with a dynamic key object; msg/code match every
// other endpoint on this API, so code is what's actually checked, exactly like the read endpoints.
const operationResponseSchema=z.object({msg:z.string(),code:z.number().int()}).passthrough();
const listResponseSchema=z.object({msg:z.string(),code:z.number().int(),list:z.array(listItemSchema)}).passthrough();
// Confirmed live against DTA55480 on 2026-09-18 ({"msg":"Device not online.","code":2004}): a
// non-zero code response carries no `data`/`list` at all, not an empty or placeholder one. The
// full schemas above require that field, so validating against them first — before the code is
// even checked — misreports every real provider error as a malformed response. This envelope is
// checked, and the code inspected, before the stricter success-only schema ever runs.
const envelopeSchema=z.object({msg:z.string(),code:z.number().int()}).passthrough();
const parseResponse=<T extends z.ZodTypeAny>(schema:T,value:unknown):z.infer<T>=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ManufacturerError('Réponse fabricant mal formée.',502,'MALFORMED');return parsed.data;};

const finite=(value:string,label:string)=>{const parsed=Number(value);if(!Number.isFinite(parsed))throw new ManufacturerError(`Réponse fabricant invalide (${label}).`,502,'MALFORMED');return parsed;};
const count=(value:string,label:string)=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0)throw new ManufacturerError(`Réponse fabricant invalide (${label}).`,502,'MALFORMED');return parsed;};
const safeBase64=(value:string)=>{let binary='';for(const byte of new TextEncoder().encode(value))binary+=String.fromCharCode(byte);return btoa(binary);};

export class ManufacturerHttpClient {
 private readonly baseUrl:string;
 private readonly timeoutMs:number;
 private readonly endpointAuth:ManufacturerEndpointAuth;
 private readonly allowPhysicalActions:boolean;
 constructor(config:ManufacturerConfig,private readonly transport:ManufacturerTransport=(url,init)=>fetch(url,init),private readonly logger:ManufacturerLogger=()=>{},endpointAuth?:ManufacturerEndpointAuth){
  // The gate sits on operateDevice() itself rather than on the whole client: reads stay available
  // even when physical actions are off, so monitoring and reconciliation never depend on it.
  this.allowPhysicalActions=config.allowPhysicalActions===true;
  if(!config.username||!config.password)throw new ManufacturerError('Identifiants fabricant manquants.',503,'AUTH');
  const base=new URL(config.baseUrl);if(base.protocol!=='https:'||base.username||base.password)throw new ManufacturerError('L’API fabricant doit utiliser une URL HTTPS sans identifiants.',503,'AUTH');
  this.baseUrl=base.toString().replace(/\/$/,'');this.timeoutMs=config.timeoutMs??8_000;
  this.endpointAuth=endpointAuth??(path=>{if(![MANUFACTURER_DEVICE_INFO_PATH,MANUFACTURER_DEVICE_LIST_PATH,MANUFACTURER_DEVICE_OPERATION_PATH].includes(path))throw new ManufacturerError('Mode d’authentification non documenté pour cet endpoint.',503,'AUTH');return {Authorization:`Basic ${safeBase64(`${config.username}:${config.password}`)}`};});
 }
 async getDeviceInfo(query:ManufacturerDeviceQuery){const raw=await this.request('GET',MANUFACTURER_DEVICE_INFO_PATH,{deviceId:query.deviceId});const envelope=parseResponse(envelopeSchema,raw);this.throwProviderError(envelope.code,envelope.msg,MANUFACTURER_DEVICE_INFO_PATH);const payload=parseResponse(deviceResponseSchema,raw);return mapDevice(query.deviceId,payload.data);}
 async listDevices(query:ManufacturerListQuery){const raw=await this.request('POST',MANUFACTURER_DEVICE_LIST_PATH,{coordType:query.coordType,zoomLevel:String(query.zoomLevel),lat:String(query.lat),lng:String(query.lng),showPrice:String(query.showPrice)});const envelope=parseResponse(envelopeSchema,raw);this.throwProviderError(envelope.code,envelope.msg,MANUFACTURER_DEVICE_LIST_PATH);const payload=parseResponse(listResponseSchema,raw);return payload.list.map(item=>({shopId:item.shop.id,name:item.shop.shopName,address:item.shop.shopAddress,latitude:finite(item.shop.latitude,'latitude'),longitude:finite(item.shop.longitude,'longitude'),batteryCount:count(item.cabinet.batteryNum,'batteryNum'),freeCount:count(item.cabinet.freeNum,'freeNum'),informationStatus:item.cabinet.infoStatus}));}
 /**
  * Confirmed endpoint (docs/EXTERNAL_BLOCKERS.md). Every operationType here moves real hardware,
  * so this is the single choke point for physical actions: it refuses unless the operator opted in
  * through MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=true, which resolveManufacturerConfig() only accepts
  * alongside a coherent rental path (see validateManufacturerStartup). Kept close to the documented
  * shape rather than only exposing 'pop': lock/unlock/restart are the same call behind the same gate.
  */
 async operateDevice(query:ManufacturerOperationQuery):Promise<ManufacturerOperationResult>{
  if(!this.allowPhysicalActions){this.logger({level:'warn',event:'manufacturer_physical_blocked',path:MANUFACTURER_DEVICE_OPERATION_PATH});throw new ManufacturerError('Action physique fabricant désactivée (MANUFACTURER_ALLOW_PHYSICAL_ACTIONS).',403,'PHYSICAL_BLOCKED');}
  const payload=parseResponse(operationResponseSchema,await this.request('POST',MANUFACTURER_DEVICE_OPERATION_PATH,{cabinetid:query.cabinetId,slotNum:String(query.slotNum),operationType:query.operationType,reason:query.reason??''}));
  this.throwProviderError(payload.code,payload.msg,MANUFACTURER_DEVICE_OPERATION_PATH);
  return payload;
 }
 private throwProviderError(code:number,msg:string,path:string){if(code!==0){this.logger({level:'warn',event:'manufacturer_api_error',path,providerCode:code});throw new ManufacturerApiError(code,msg||'Erreur API fabricant.');}}
 private async request(method:'GET'|'POST',path:string,params:Record<string,string>){
  const url=new URL(this.baseUrl+path);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{const response=await this.transport(url.toString(),{method,headers:{...this.endpointAuth(path),Accept:'application/json'},signal:controller.signal});if(response.status===401||response.status===403){this.logger({level:'warn',event:'manufacturer_auth_error',path,status:response.status});throw new ManufacturerError('Authentification fabricant refusée.',502,'AUTH');}if(!response.ok){this.logger({level:'error',event:'manufacturer_http_error',path,status:response.status});throw new ManufacturerError('API fabricant indisponible.',503,'UNAVAILABLE');}const raw=await response.text();if(raw.length>1_000_000)throw new ManufacturerError('Réponse fabricant trop volumineuse.',502,'MALFORMED');try{return JSON.parse(raw) as unknown;}catch{throw new ManufacturerError('Réponse fabricant illisible.',502,'MALFORMED');}}
  catch(error){if(controller.signal.aborted){this.logger({level:'warn',event:'manufacturer_timeout',path});throw new ManufacturerError('Délai de réponse fabricant dépassé.',504,'TIMEOUT');}if(error instanceof ManufacturerError)throw error;this.logger({level:'error',event:'manufacturer_unavailable',path});throw new ManufacturerError('API fabricant indisponible.',503,'UNAVAILABLE');}finally{clearTimeout(timeout);}
 }
}

function mapDevice(deviceId:string,data:z.infer<typeof deviceResponseSchema>['data']):ManufacturerDeviceSnapshot {const positions=new Set<number>(),batteryIds=new Set<string>();for(const battery of data.batteries){if(battery.slotNum>data.cabinet.slots||positions.has(battery.slotNum)||batteryIds.has(battery.batteryId))throw new ManufacturerError('Réponse fabricant incohérente (slots/batteries).',502,'MALFORMED');positions.add(battery.slotNum);batteryIds.add(battery.batteryId);}const batteries=data.batteries.map(b=>({id:b.batteryId,slot:b.slotNum,voltage:b.vol}));const bySlot=new Map(batteries.map(b=>[b.slot,b]));return {deviceId,cabinetId:data.cabinet.id,qrCode:data.cabinet.qrCode,online:data.cabinet.online,totalSlots:data.cabinet.slots,emptySlots:data.cabinet.emptySlots,busySlots:data.cabinet.busySlots,signal:data.cabinet.signal,type:data.cabinet.type,ip:data.cabinet.ip,shopId:data.shop.id,shopName:data.shop.name,shopAddress:data.shop.address,latitude:data.shop.latitude===''?null:finite(data.shop.latitude,'latitude'),longitude:data.shop.longitude===''?null:finite(data.shop.longitude,'longitude'),batteries,slots:Array.from({length:data.cabinet.slots},(_,index)=>({position:index+1,battery:bySlot.get(index+1)??null})),availability:batteries.length,lastSeenAt:null};}

/** Read-only manufacturer adapter. Every mutating/physical method fails closed. */
export class ManufacturerBatteryStationProvider implements BatteryStationProvider {
 constructor(private readonly client:ManufacturerHttpClient){}
 getStation(d:Data,id:string){const station=d.stations.find(s=>s.id===id||s.publicId===id||s.providerDeviceId===id);if(!station)throw new DomainError('Station introuvable.',404);return station;}
 getAvailability(d:Data,id:string){const station=this.getStation(d,id);return d.slots.filter(slot=>slot.stationId===station.id&&d.batteries.some(b=>b.id===slot.batteryId&&b.status==='AVAILABLE')).length;}
 getDeviceInfo(deviceId:string){return this.client.getDeviceInfo({deviceId});}
 listDevices(query:ManufacturerListQuery){return this.client.listDevices(query);}
 ejectBattery(...args:Parameters<BatteryStationProvider['ejectBattery']>):string{void args;throw this.physicalBlocked();}
 returnBattery(...args:Parameters<BatteryStationProvider['returnBattery']>):void{void args;throw this.physicalBlocked();}
 setOnline(...args:Parameters<BatteryStationProvider['setOnline']>):void{void args;throw this.physicalBlocked();}
 simulateFailure(...args:Parameters<BatteryStationProvider['simulateFailure']>):void{void args;throw this.physicalBlocked();}
 private physicalBlocked(){return new ManufacturerError('Action physique fabricant interdite en mode READ-ONLY.',403,'PHYSICAL_BLOCKED');}
}

/**
 * Concrete AsyncBatteryEjector (core/stripe-coordinator.ts) for real hardware. That interface's
 * own comment notes ejectBatteryAsync() has no Data access — which rules out picking a slot from
 * a local snapshot, but not a plain non-transactional repository.read(). This uses that read only
 * to resolve which physical cabinet backs the station; the slot/battery choice itself always
 * comes from a fresh cabinet/query, the manufacturer's own live view, never from local state that
 * could already be stale. Nothing here runs inside a repository transaction.
 * Still unreachable in production: resolveManufacturerConfig()/ManufacturerHttpClient both refuse
 * to exist unless MANUFACTURER_ALLOW_PHYSICAL_ACTIONS is exactly 'false', and nothing in server/
 * constructs this class yet. See docs/EXTERNAL_BLOCKERS.md.
 */
export class ManufacturerBatteryEjector {
 constructor(private readonly client:Pick<ManufacturerHttpClient,'getDeviceInfo'|'operateDevice'>,private readonly repository:Repository){}
 async ejectBatteryAsync(stationId:string):Promise<string>{
  const data=await this.repository.read();
  const link=data.stationProviderLinks.find(row=>row.stationId===stationId&&row.active);
  const externalId=link?.externalId??data.stations.find(s=>s.id===stationId)?.providerDeviceId;
  if(!externalId)throw new DomainError('Aucune borne fabricant associée à cette station.',503);
  const snapshot=await this.client.getDeviceInfo({deviceId:externalId});
  if(!snapshot.online)throw new DomainError('Borne fabricant hors ligne.',503);
  const candidates=snapshot.slots.filter((slot):slot is ManufacturerSlotSnapshot&{battery:ManufacturerBatterySnapshot}=>slot.battery!==null);
  if(!candidates.length)throw new DomainError('Aucune batterie disponible sur cette borne.',409);
  // Best-charged battery first: a simple, deterministic policy rather than an arbitrary slot order.
  const chosen=candidates.reduce((best,slot)=>slot.battery.voltage>best.battery.voltage?slot:best);
  try{await this.client.operateDevice({cabinetId:externalId,slotNum:chosen.position,operationType:'pop',reason:'BATYEO rental'});}
  catch(error){
   // A confirmed API error (non-zero code) means the manufacturer told us clearly it failed —
   // that propagates as-is. Only a timeout/network failure leaves the physical outcome unknown.
   if(error instanceof ManufacturerError&&(error.kind==='TIMEOUT'||error.kind==='UNAVAILABLE'))throw new PhysicalResultUnknownError(`Éjection fabricant incertaine (borne ${externalId}, slot ${chosen.position}) : ${error.message}`);
   throw error;
  }
  return chosen.battery.id;
 }
}

export interface ManufacturerStationDifference {kind:'ONLINE_STATUS'|'AVAILABILITY'|'CAPACITY'|'SLOT_BATTERY';position?:number;local:unknown;provider:unknown;}
export interface ProviderContractDrift {path:string;kind:'ADDED_FIELD'|'MISSING_FIELD'|'TYPE_CHANGED';expected?:string;observed?:string;critical:boolean;}
/** Compares observed provider payload shape without assigning undocumented business meaning. */
export function detectProviderContractDrift(expected:unknown, observed:unknown, path='$'):ProviderContractDrift[]{
 const result:ProviderContractDrift[]=[];
 if(Array.isArray(expected)||Array.isArray(observed)){if(Array.isArray(expected)!==Array.isArray(observed))result.push({path,kind:'TYPE_CHANGED',expected:Array.isArray(expected)?'array':'object',observed:Array.isArray(observed)?'array':typeof observed,critical:true});return result;}
 if(expected===null||observed===null||typeof expected!=='object'||typeof observed!=='object'){if(typeof expected!==typeof observed)result.push({path,kind:'TYPE_CHANGED',expected:typeof expected,observed:typeof observed,critical:true});return result;}
 const expectedKeys=new Set(Object.keys(expected as object)), observedKeys=new Set(Object.keys(observed as object));
 for(const key of expectedKeys)if(!observedKeys.has(key))result.push({path:`${path}.${key}`,kind:'MISSING_FIELD',expected:typeof (expected as Record<string,unknown>)[key],critical:false});
 for(const key of observedKeys)if(!expectedKeys.has(key))result.push({path:`${path}.${key}`,kind:'ADDED_FIELD',observed:typeof (observed as Record<string,unknown>)[key],critical:false});
 for(const key of expectedKeys)if(observedKeys.has(key))result.push(...detectProviderContractDrift((expected as Record<string,unknown>)[key],(observed as Record<string,unknown>)[key],`${path}.${key}`));
 return result;
}
export function reconcileManufacturerStation(d:Data,localStation:Station,snapshot:ManufacturerDeviceSnapshot):ManufacturerStationDifference[]{const differences:ManufacturerStationDifference[]=[];if(localStation.online!==snapshot.online)differences.push({kind:'ONLINE_STATUS',local:localStation.online,provider:snapshot.online});if(localStation.capacity!==snapshot.totalSlots)differences.push({kind:'CAPACITY',local:localStation.capacity,provider:snapshot.totalSlots});const localAvailability=d.slots.filter(slot=>slot.stationId===localStation.id&&d.batteries.some(b=>b.id===slot.batteryId&&b.status==='AVAILABLE')).length;if(localAvailability!==snapshot.availability)differences.push({kind:'AVAILABILITY',local:localAvailability,provider:snapshot.availability});for(const providerSlot of snapshot.slots){const local=d.slots.find(slot=>slot.stationId===localStation.id&&slot.position===providerSlot.position);const providerBattery=providerSlot.battery?.id??null;if((local?.batteryId??null)!==providerBattery)differences.push({kind:'SLOT_BATTERY',position:providerSlot.position,local:local?.batteryId??null,provider:providerBattery});}return differences;}

/** Applies only unambiguous telemetry. Slot/battery differences require operator review. */
export function applyManufacturerStationTelemetry(d:Data,stationId:string,snapshot:ManufacturerDeviceSnapshot,syncedAt=Date.now()){const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);if(station.providerDeviceId&&station.providerDeviceId!==snapshot.deviceId)throw new ManufacturerError('Identifiant fabricant incohérent pour cette station.',409,'MALFORMED');const differences=reconcileManufacturerStation(d,station,snapshot);station.provider='manufacturer';station.providerDeviceId=snapshot.deviceId;station.providerStatus=snapshot.online?'ONLINE':'OFFLINE';station.providerLastSyncedAt=syncedAt;return {station,differences};}

export function resolveManufacturerConfig(env:Record<string,string|undefined>):ManufacturerConfig|undefined {
 // Only the two exact literals are accepted: a typo ('yes', 'TRUE', '1') must fail closed rather
 // than be read as truthy or silently fall back to false, because both mistakes are dangerous.
 const flag=env.MANUFACTURER_ALLOW_PHYSICAL_ACTIONS??'false';if(flag!=='true'&&flag!=='false')throw new ManufacturerError("MANUFACTURER_ALLOW_PHYSICAL_ACTIONS n'accepte que 'true' ou 'false'.",503,'PHYSICAL_BLOCKED');
 const allowPhysicalActions=flag==='true';const provider=env.MANUFACTURER_PROVIDER?.trim().toLowerCase();
 if(allowPhysicalActions&&provider!=='bajie')throw new ManufacturerError('Les actions physiques exigent MANUFACTURER_PROVIDER=bajie.',503,'PHYSICAL_BLOCKED');if(!provider){if(env.MANUFACTURER_USERNAME||env.MANUFACTURER_PASSWORD)throw new ManufacturerError('MANUFACTURER_PROVIDER=bajie est requis lorsque des credentials fabricant sont configurés.',503,'AUTH');return undefined;}if(provider==='disabled'){if(env.MANUFACTURER_USERNAME||env.MANUFACTURER_PASSWORD)throw new ManufacturerError('Credentials fabricant présents alors que le provider est désactivé.',503,'AUTH');return undefined;}if(provider!=='bajie')throw new ManufacturerError('Provider fabricant non supporté.',503,'AUTH');const username=env.MANUFACTURER_USERNAME,password=env.MANUFACTURER_PASSWORD,baseUrl=env.MANUFACTURER_API_BASE_URL;if(!username||!password||!baseUrl)throw new ManufacturerError('Configuration Bajie incomplète : URL, username et password sont requis.',503,'AUTH');return {baseUrl,username,password,allowPhysicalActions};}
export function validateManufacturerStartup(env:Record<string,string|undefined>):ManufacturerConfig|undefined {
 const config=resolveManufacturerConfig(env);if(config&&!env.MANUFACTURER_SYNC_SECRET)throw new ManufacturerError('MANUFACTURER_SYNC_SECRET est requis pour le scheduler staging.',503,'AUTH');
 // A real ejection is a network call, and only the Stripe path has the asynchronous seam for one
 // (AsyncBatteryEjector). RentalEngine.start(), used in mock payment mode, ejects synchronously
 // inside the transaction through MockBatteryStationProvider — with a station linked to real
 // hardware it would mark a rental ACTIVE on a battery that never physically left. Fail closed
 // on that combination at startup instead of discovering it on a customer's first rental.
 if(config?.allowPhysicalActions&&resolvePaymentMode(env)!=='stripe_test')throw new ManufacturerError('Les éjections physiques réelles exigent PAYMENT_PROVIDER=stripe_test : le mode mock éjecte de façon synchrone et ne pilote aucune borne réelle.',503,'PHYSICAL_BLOCKED');
 return config;
}
