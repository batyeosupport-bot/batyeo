import type {Repository} from './repository';
import type {Actor,Data,ManufacturerName,ProviderHealth,ReconciliationKind,StationProviderLink,StationProviderSnapshot} from './types';
import type {ManufacturerDeviceSnapshot} from './manufacturer';
import {ManufacturerError} from './manufacturer';
import {DomainError} from './providers';

export interface ManufacturerReadProvider {getDeviceInfo(externalId:string):Promise<ManufacturerDeviceSnapshot>;}
export interface SyncLog {level:'info'|'warn'|'error';event:string;stationId?:string;kind?:string;}
type Difference={kind:ReconciliationKind;position:number|null;local:unknown;provider:unknown};

export function linkManufacturerStation(d:Data,stationId:string,manufacturer:ManufacturerName,externalId:string,now=Date.now()):StationProviderLink {
 const station=d.stations.find(row=>row.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 const normalized=externalId.trim();if(!normalized)throw new DomainError('Identifiant fabricant invalide.',400);
 const duplicate=d.stationProviderLinks.find(link=>link.manufacturer===manufacturer&&link.externalId===normalized&&link.stationId!==stationId);if(duplicate)throw new DomainError('Cet identifiant fabricant est déjà associé à une station.',409);
 for(const link of d.stationProviderLinks)if(link.stationId===stationId&&link.manufacturer===manufacturer){link.active=false;link.updatedAt=now;}
 let link=d.stationProviderLinks.find(row=>row.stationId===stationId&&row.manufacturer===manufacturer&&row.externalId===normalized);
 if(link){link.active=true;link.updatedAt=now;}else {link={id:crypto.randomUUID(),stationId,manufacturer,externalId:normalized,active:true,createdAt:now,updatedAt:now};d.stationProviderLinks.push(link);}
 // Compatibility projection; provider links remain the durable extensible mapping.
 station.provider='manufacturer';station.providerDeviceId=normalized;return link;
}

export function compareManufacturerSnapshot(d:Data,link:StationProviderLink,snapshot:ManufacturerDeviceSnapshot):Difference[]{
 const station=d.stations.find(row=>row.id===link.stationId);if(!station)throw new DomainError('Station introuvable.',404);
 const localSlots=d.slots.filter(slot=>slot.stationId===station.id),localBatteryIds=new Set(localSlots.flatMap(slot=>slot.batteryId?[slot.batteryId]:[]));
 const providerBatteryIds=new Set(snapshot.batteries.map(battery=>battery.id));const differences:Difference[]=[];
 if(station.online!==snapshot.online)differences.push({kind:'STATION_STATUS',position:null,local:station.online,provider:snapshot.online});
 if(localBatteryIds.size!==snapshot.batteries.length)differences.push({kind:'BATTERY_COUNT',position:null,local:localBatteryIds.size,provider:snapshot.batteries.length});
 const available=localSlots.filter(slot=>slot.batteryId&&d.batteries.some(battery=>battery.id===slot.batteryId&&battery.status==='AVAILABLE')).length;
 if(available!==snapshot.availability)differences.push({kind:'AVAILABILITY',position:null,local:available,provider:snapshot.availability});
 for(const providerSlot of snapshot.slots){const local=localSlots.find(slot=>slot.position===providerSlot.position);const providerId=providerSlot.battery?.id??null;if(!local)differences.push({kind:'UNKNOWN_SLOT',position:providerSlot.position,local:null,provider:providerId});else if(local.batteryId!==providerId)differences.push({kind:'SLOT_MISMATCH',position:providerSlot.position,local:local.batteryId,provider:providerId});if(providerId&&!d.batteries.some(battery=>battery.id===providerId))differences.push({kind:'UNKNOWN_BATTERY',position:providerSlot.position,local:null,provider:providerId});}
 for(const localId of localBatteryIds)if(!providerBatteryIds.has(localId)){const position=localSlots.find(slot=>slot.batteryId===localId)?.position??null;differences.push({kind:'MISSING_BATTERY',position,local:localId,provider:null});}
 return differences;
}

function normalizedSnapshot(link:StationProviderLink,snapshot:ManufacturerDeviceSnapshot,now:number):StationProviderSnapshot{return {id:`snapshot-${link.id}`,linkId:link.id,stationId:link.stationId,syncedAt:now,online:snapshot.online,totalSlots:snapshot.totalSlots,emptySlots:snapshot.emptySlots,busySlots:snapshot.busySlots,availability:snapshot.availability,signal:snapshot.signal,deviceType:snapshot.type,ip:snapshot.ip,shopId:snapshot.shopId,shopName:snapshot.shopName,shopAddress:snapshot.shopAddress,slots:snapshot.slots.map(slot=>({position:slot.position,batteryId:slot.battery?.id??null,voltage:slot.battery?.voltage??null}))};}

function persistComparison(d:Data,link:StationProviderLink,snapshot:ManufacturerDeviceSnapshot,now:number){
 const station=d.stations.find(row=>row.id===link.stationId);if(!station)throw new DomainError('Station introuvable.',404);const differences=compareManufacturerSnapshot(d,link,snapshot);
 const keys=new Set(differences.map(diff=>`${diff.kind}:${diff.position??''}`));
 for(const diff of differences){const open=d.reconciliationRecords.find(record=>record.linkId===link.id&&record.kind===diff.kind&&record.position===diff.position&&record.status==='OPEN');if(open){open.localValue=diff.local;open.providerValue=diff.provider;open.lastDetectedAt=now;}else d.reconciliationRecords.push({id:crypto.randomUUID(),stationId:station.id,linkId:link.id,kind:diff.kind,position:diff.position,localValue:diff.local,providerValue:diff.provider,status:'OPEN',firstDetectedAt:now,lastDetectedAt:now,resolvedAt:null});}
 for(const record of d.reconciliationRecords)if(record.linkId===link.id&&record.status==='OPEN'&&!keys.has(`${record.kind}:${record.position??''}`)){record.status='RESOLVED';record.resolvedAt=now;record.lastDetectedAt=now;}
 const mapped=normalizedSnapshot(link,snapshot,now),index=d.stationProviderSnapshots.findIndex(row=>row.linkId===link.id);if(index<0)d.stationProviderSnapshots.push(mapped);else d.stationProviderSnapshots[index]=mapped;
 station.provider='manufacturer';station.providerDeviceId=link.externalId;station.providerStatus=snapshot.online?'ONLINE':'OFFLINE';station.providerLastSyncedAt=now;
 return differences;
}

function recordProviderFailure(d:Data,link:StationProviderLink,error:unknown,now:number){const kind=error instanceof ManufacturerError&&error.kind==='MALFORMED'?'MALFORMED_PROVIDER_RESPONSE':'PROVIDER_ERROR';const provider={kind:error instanceof ManufacturerError?error.kind:'UNKNOWN'};const current=d.reconciliationRecords.find(record=>record.linkId===link.id&&record.kind===kind&&record.status==='OPEN');if(current){current.providerValue=provider;current.lastDetectedAt=now;}else d.reconciliationRecords.push({id:crypto.randomUUID(),stationId:link.stationId,linkId:link.id,kind,position:null,localValue:null,providerValue:provider,status:'OPEN',firstDetectedAt:now,lastDetectedAt:now,resolvedAt:null});}

export function providerHealth(d:Data,now=Date.now(),freshForMs=15*60_000):{status:ProviderHealth;lastSyncAt:number|null;recentFailures:number;openMismatches:number}{const completed=d.manufacturerSyncRuns.filter(run=>run.provider==='BAJIE'&&run.status!=='RUNNING').sort((a,b)=>(b.completedAt??b.startedAt)-(a.completedAt??a.startedAt));const last=completed[0],lastSyncAt=last?.completedAt??null,openMismatches=d.reconciliationRecords.filter(record=>record.status==='OPEN').length,recentFailures=completed.filter(run=>(run.completedAt??run.startedAt)>=now-freshForMs&&run.failed>0).length;if(!d.stationProviderLinks.some(link=>link.active)||!lastSyncAt)return {status:'UNKNOWN',lastSyncAt:lastSyncAt??null,recentFailures,openMismatches};if(lastSyncAt<now-freshForMs)return {status:last?.status==='FAILED'?'DOWN':'DEGRADED',lastSyncAt,recentFailures,openMismatches};if(last?.status==='FAILED')return {status:'DOWN',lastSyncAt,recentFailures,openMismatches};if(last?.status==='PARTIAL'||openMismatches>0)return {status:'DEGRADED',lastSyncAt,recentFailures,openMismatches};return {status:'HEALTHY',lastSyncAt,recentFailures,openMismatches};}

export class ManufacturerSyncService {
 constructor(private readonly repository:Repository,private readonly provider:ManufacturerReadProvider,private readonly options:{attempts?:number;baseDelayMs?:number;lockMs?:number;sleep?:(ms:number)=>Promise<void>;now?:()=>number;logger?:(entry:SyncLog)=>void}={}){}
 async run(input:{trigger:'SCHEDULED'|'MANUAL'|'WEBHOOK';requestedBy?:Actor|null;stationId?:string}){
  const now=this.options.now??Date.now,runId=crypto.randomUUID();const source=await this.repository.read();let links=source.stationProviderLinks.filter(link=>link.active&&(!input.stationId||link.stationId===input.stationId));
  // Backward-compatible read-only mappings created before the link registry existed.
  if(!links.length&&input.stationId){const station=source.stations.find(row=>row.id===input.stationId);if(station?.providerDeviceId)await this.repository.transaction(d=>{linkManufacturerStation(d,station.id,'BAJIE',station.providerDeviceId!,now());});links=(await this.repository.read()).stationProviderLinks.filter(link=>link.active&&link.stationId===input.stationId);}
  const lock=await this.repository.transaction(d=>{const at=now(),lockMs=this.options.lockMs??10*60_000;const running=d.manufacturerSyncRuns.find(run=>run.provider==='BAJIE'&&run.status==='RUNNING'&&run.startedAt>at-lockMs);if(running)return {acquired:false,run:structuredClone(running)};for(const stale of d.manufacturerSyncRuns.filter(run=>run.provider==='BAJIE'&&run.status==='RUNNING')){stale.status='FAILED';stale.completedAt=at;stale.errorSummary.push({stationId:'*',kind:'STALE_LOCK_EXPIRED'});}const run={id:runId,provider:'BAJIE' as const,trigger:input.trigger,requestedBy:input.requestedBy?.id??null,startedAt:at,completedAt:null,status:'RUNNING' as const,total:links.length,succeeded:0,failed:0,mismatches:0,errorSummary:[]};d.manufacturerSyncRuns.push(run);return {acquired:true,run:structuredClone(run)};});if(!lock.acquired)return {...lock.run,skipped:true as const};
  for(const link of links){try{const snapshot=await this.readWithRetry(link.externalId);await this.repository.transaction(d=>{const current=d.stationProviderLinks.find(row=>row.id===link.id&&row.active);if(!current)throw new DomainError('Association fabricant modifiée pendant la synchronisation.',409);const differences=persistComparison(d,current,snapshot,now());for(const record of d.reconciliationRecords)if(record.linkId===current.id&&record.status==='OPEN'&&['PROVIDER_ERROR','MALFORMED_PROVIDER_RESPONSE'].includes(record.kind)){record.status='RESOLVED';record.resolvedAt=now();record.lastDetectedAt=now();}const run=d.manufacturerSyncRuns.find(row=>row.id===runId)!;run.succeeded++;run.mismatches+=differences.length;});this.options.logger?.({level:'info',event:'manufacturer_sync_station_ok',stationId:link.stationId});}catch(error){await this.repository.transaction(d=>{const run=d.manufacturerSyncRuns.find(row=>row.id===runId)!;run.failed++;const kind=error instanceof ManufacturerError?error.kind:'UNKNOWN';run.errorSummary.push({stationId:link.stationId,kind});const station=d.stations.find(row=>row.id===link.stationId);if(station)station.providerStatus='ERROR';recordProviderFailure(d,link,error,now());});this.options.logger?.({level:'error',event:'manufacturer_sync_station_failed',stationId:link.stationId,kind:error instanceof ManufacturerError?error.kind:'UNKNOWN'});}}
  return this.repository.transaction(d=>{const run=d.manufacturerSyncRuns.find(row=>row.id===runId)!;run.completedAt=now();run.status=run.failed===0?'COMPLETED':run.succeeded===0?'FAILED':'PARTIAL';return {...structuredClone(run),skipped:false as const};});
 }
 private async readWithRetry(externalId:string){const attempts=this.options.attempts??3,base=this.options.baseDelayMs??100,sleep=this.options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));for(let attempt=1;;attempt++)try{return await this.provider.getDeviceInfo(externalId);}catch(error){const safe=error instanceof ManufacturerError&&['TIMEOUT','UNAVAILABLE'].includes(error.kind);if(!safe||attempt>=attempts)throw error;await sleep(base*2**(attempt-1));}}
}
