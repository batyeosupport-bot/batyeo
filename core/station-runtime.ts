import type {ProviderHealth} from './types';
import {type Playlist} from './media';
import {type RuntimeTranslations} from './i18n';
import {applyRuntimeConfig, validateRuntimeConfig, type RuntimeConfigEnvelope} from './runtime-config';

export const STATION_RUNTIME_STATES=['IDLE','READY','SCAN_QR','SELECT_INFO','PAYMENT_PENDING','EJECTING','SUCCESS','ERROR','OFFLINE','MAINTENANCE','NO_BATTERY'] as const;
export type StationRuntimeState=typeof STATION_RUNTIME_STATES[number];
export interface StationDisplayConfig {version:number;venueName:string;locale:string;idleContent:string;supportContact:string;maintenanceBanner:string|null;refreshIntervalMs:number;featureFlags:Record<string,boolean>;advertisingSlots:readonly string[];playlist?:Playlist|null;translations?:RuntimeTranslations|null;}
/** Per-station display configuration owned by the admin portal. `updatedAt` doubles as the monotonic config version pushed to runtimes. */
export interface StationDisplayConfigRecord {id:string;stationId:string;idleContent:string;supportContact:string;maintenanceBanner:string|null;locale:string;refreshIntervalMs:number;featureFlags:Record<string,boolean>;translations:RuntimeTranslations|null;updatedAt:number;}
export interface StationPublicSnapshot {stationId:string;publicId:string;venueName:string;online:boolean;availableBatteries:number;capacity:number;hourlyCents:number;capCents:number;depositCents:number;qrTarget:string;providerHealth:ProviderHealth;}
export interface StationRuntimeAdapter {getState():StationRuntimeState;render(snapshot:StationPublicSnapshot,config:StationDisplayConfig):Promise<void>|void;setState(state:StationRuntimeState):Promise<void>|void;readCachedConfig():StationDisplayConfig|null;writeCachedConfig(config:StationDisplayConfig):Promise<void>|void;}
export interface StationRuntimeClock {now():number;}
const valid=(state:string):state is StationRuntimeState=>STATION_RUNTIME_STATES.includes(state as StationRuntimeState);
const transitions:Record<StationRuntimeState,readonly StationRuntimeState[]>={IDLE:['READY','OFFLINE','MAINTENANCE'],READY:['SCAN_QR','NO_BATTERY','OFFLINE','MAINTENANCE','IDLE'],SCAN_QR:['SELECT_INFO','ERROR','IDLE'],SELECT_INFO:['PAYMENT_PENDING','IDLE','ERROR'],PAYMENT_PENDING:['EJECTING','ERROR','IDLE'],EJECTING:['SUCCESS','ERROR','IDLE'],SUCCESS:['IDLE','READY'],ERROR:['IDLE','READY','OFFLINE'],OFFLINE:['IDLE','READY','MAINTENANCE'],MAINTENANCE:['IDLE','OFFLINE'],NO_BATTERY:['READY','IDLE','OFFLINE']};
export function transitionStationRuntime(from:StationRuntimeState,to:StationRuntimeState){if(!valid(from)||!valid(to)||!transitions[from].includes(to))throw new Error(`Invalid station runtime transition: ${from} -> ${to}`);return to;}
export class StationRuntimeController {
 private state:StationRuntimeState;
 private config:StationDisplayConfig|null;
 private configWrites:Promise<void>=Promise.resolve();
 private interruptedState:StationRuntimeState|null=null;
 constructor(private readonly adapter:StationRuntimeAdapter,private readonly clock:StationRuntimeClock={now:Date.now}){this.state=adapter.getState();if(!valid(this.state))this.state='ERROR';this.config=null;try{const cached=adapter.readCachedConfig();if(cached)this.config=structuredClone(validateRuntimeConfig(cached));}catch{this.state='ERROR';}}
 getState(){return this.state;}
 getConfig(){return this.config?structuredClone(this.config):null;}
 private queueConfig<T>(operation:()=>Promise<T>):Promise<T>{
  const result=this.configWrites.then(operation);
  // A failed storage operation must not poison subsequent retries.
  this.configWrites=result.then(()=>undefined,()=>undefined);
  return result;
 }
 async applyConfig(config:StationDisplayConfig){
  const next=structuredClone(validateRuntimeConfig(config));
  return this.queueConfig(async()=>{
   if(this.config&&next.version<=this.config.version)return false;
   await this.adapter.writeCachedConfig(structuredClone(next));this.config=next;return true;
  });
 }
 async applyConfigEnvelope(envelope:RuntimeConfigEnvelope){
  const input=structuredClone(envelope);
  return this.queueConfig(async()=>{
   const decision=applyRuntimeConfig(this.config,this.config,input);
   if(decision.status==='APPLIED'){
    await this.adapter.writeCachedConfig(structuredClone(decision.config));
    this.config=structuredClone(decision.config);
   }
   return structuredClone(decision);
  });
 }
 async enter(state:StationRuntimeState){if(state===this.state)return state;const next=transitionStationRuntime(this.state,state);await this.adapter.setState(next);this.state=next;return next;}
 async render(snapshot:StationPublicSnapshot){
  if(!this.config)throw new Error('Station display configuration unavailable.');
  if(this.state!=='MAINTENANCE'){
   if(!snapshot.online){
    // Losing connectivity changes display availability, never the rental/physical state.
    if(this.state!=='OFFLINE'){const previous=this.state;await this.adapter.setState('OFFLINE');this.interruptedState=['SCAN_QR','SELECT_INFO','PAYMENT_PENDING','EJECTING','SUCCESS','ERROR'].includes(previous)?previous:null;this.state='OFFLINE';}
   }else if(['IDLE','READY','OFFLINE','NO_BATTERY'].includes(this.state)){
    const next=this.interruptedState??(snapshot.availableBatteries>0?'READY':'NO_BATTERY');
    if(next!==this.state){await this.adapter.setState(next);this.state=next;this.interruptedState=null;}
   }
  }
  await this.adapter.render(snapshot,structuredClone(this.config));return {state:this.state,renderedAt:this.clock.now(),usingCachedConfig:true};
 }
}
