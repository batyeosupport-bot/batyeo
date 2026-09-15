import test from 'node:test';
import assert from 'node:assert/strict';
import {HardwareCommandSafety,transitionHardwareCommand} from '../core/hardware-commands';
import {HeartbeatRegistry,heartbeatHealth} from '../core/heartbeat';
import {StationRuntimeController,transitionStationRuntime,type StationDisplayConfig, type StationRuntimeAdapter} from '../core/station-runtime';
const config:StationDisplayConfig={version:1,venueName:'Demo',locale:'fr-FR',idleContent:'Scan',supportContact:'support',maintenanceBanner:null,refreshIntervalMs:10_000,featureFlags:{},advertisingSlots:[]};
test('station runtime transitions and cached config never perform physical actions',async()=>{let state:'IDLE'|'READY'='IDLE',cached:StationDisplayConfig|null=config;const adapter:StationRuntimeAdapter={getState:()=>state,render:()=>{},setState:next=>{state=next as typeof state},readCachedConfig:()=>cached,writeCachedConfig:next=>{cached=next}};const runtime=new StationRuntimeController(adapter,{now:()=>10});await runtime.enter('READY');const result=await runtime.render({stationId:'s',publicId:'S',venueName:'Demo',online:true,availableBatteries:1,capacity:4,hourlyCents:200,capCents:800,depositCents:2000,qrTarget:'/rent/S',providerHealth:'UNKNOWN'});assert.equal(result.state,'READY');assert.throws(()=>transitionStationRuntime('READY','SUCCESS'));});
test('heartbeat ordering and health distinguish runtime from provider state',()=>{const registry=new HeartbeatRegistry();assert.equal(registry.record({stationId:'s',runtimeVersion:'1',at:100,network:'ONLINE',appUptimeMs:1,displayStatus:'OK',providerStatus:'OFFLINE',lastCoreContactAt:100,errors:[]}),true);assert.equal(registry.record({stationId:'s',runtimeVersion:'1',at:90,network:'OFFLINE',appUptimeMs:1,displayStatus:'ERROR',providerStatus:'ONLINE',lastCoreContactAt:90,errors:['x']}),false);assert.equal(registry.health('s',100),'ONLINE');assert.equal(heartbeatHealth(undefined,100),'UNKNOWN');assert.equal(registry.health('s',200_001),'OFFLINE');});
test('hardware safety refuses physical send and blind retry after uncertainty',()=>{const safety=new HardwareCommandSafety(false),command=safety.create('s','EJECT_BATTERY',100);assert.throws(()=>safety.send(command),/No physical provider/);transitionHardwareCommand(command,'UNKNOWN_RESULT',200);assert.throws(()=>transitionHardwareCommand(command,'SENT',300),/incertain/);});

test('runtime stays offline or empty across repeated refreshes and recovers',async()=>{
 const adapter:StationRuntimeAdapter={getState:()=> 'IDLE',readCachedConfig:()=>config,writeCachedConfig:()=>{},render:()=>{},setState:()=>{}};
 const runtime=new StationRuntimeController(adapter);
 const snapshot={stationId:'s',publicId:'s',venueName:'Demo',online:false,availableBatteries:0,capacity:4,hourlyCents:200,capCents:800,depositCents:2000,qrTarget:'/rent/s',providerHealth:'UNKNOWN' as const};
 for(let i=0;i<3;i++)assert.equal((await runtime.render(snapshot)).state,'OFFLINE');
 for(let i=0;i<3;i++)assert.equal((await runtime.render({...snapshot,online:true})).state,'NO_BATTERY');
 assert.equal((await runtime.render({...snapshot,online:true,availableBatteries:1})).state,'READY');
});
test('failed cache write preserves last valid config and corrupted boot cache is rejected',async()=>{
 const adapter:StationRuntimeAdapter={getState:()=> 'IDLE',readCachedConfig:()=>config,writeCachedConfig:()=>{throw new Error('storage full');},render:()=>{},setState:()=>{}};
 const runtime=new StationRuntimeController(adapter);
 await assert.rejects(()=>runtime.applyConfig({...config,version:2}));assert.equal(runtime.getConfig()?.version,1);
 const broken=new StationRuntimeController({...adapter,readCachedConfig:()=>({...config,refreshIntervalMs:NaN})});
 assert.equal(broken.getState(),'ERROR');assert.equal(broken.getConfig(),null);
});

test('reconnect during ejection never returns the display to a new rental prompt',async()=>{
 const runtime=new StationRuntimeController({getState:()=> 'EJECTING',readCachedConfig:()=>config,writeCachedConfig:()=>{},render:()=>{},setState:()=>{}});
 const snapshot={stationId:'s',publicId:'s',venueName:'Demo',online:false,availableBatteries:1,capacity:4,hourlyCents:200,capCents:800,depositCents:2000,qrTarget:'/rent/s',providerHealth:'UNKNOWN' as const};
 assert.equal((await runtime.render(snapshot)).state,'OFFLINE');
 assert.equal((await runtime.render({...snapshot,online:true})).state,'EJECTING');
});

test('overlapping envelope and direct config writes preserve the highest committed version',async()=>{
 let release!:()=>void;
 let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const writes:number[]=[];
 let cache=config;
 const runtime=new StationRuntimeController({getState:()=> 'IDLE',readCachedConfig:()=>cache,render:()=>{},setState:()=>{},writeCachedConfig:async next=>{
  writes.push(next.version);
  if(next.version===2){started();await blocked;}
  cache=next;
 }});
 const first=runtime.applyConfig({...config,version:2});
 await entered;
 const {checksumConfig}=await import('../core/runtime-config');
 const newest={...config,version:4};
 const second=runtime.applyConfigEnvelope({config:newest,checksum:checksumConfig(newest),issuedAt:1});
 const stale=runtime.applyConfig({...config,version:3});
 release();
 assert.equal(await first,true);assert.equal((await second).status,'APPLIED');assert.equal(await stale,false);
 assert.deepEqual(writes,[2,4]);assert.equal(cache.version,4);assert.equal(runtime.getConfig()?.version,4);
});

test('failed config write does not block retry and callers cannot mutate committed config',async()=>{
 let attempts=0;
 const runtime=new StationRuntimeController({getState:()=> 'IDLE',readCachedConfig:()=>config,render:()=>{},setState:()=>{},writeCachedConfig:()=>{if(++attempts===1)throw new Error('temporary storage failure');}});
 const next={...config,version:2,featureFlags:{demo:true}};
 await assert.rejects(()=>runtime.applyConfig(next));
 assert.equal(await runtime.applyConfig(next),true);
 next.featureFlags.demo=false;
 const exposed=runtime.getConfig()!;exposed.version=99;exposed.featureFlags.demo=false;
 assert.equal(runtime.getConfig()?.version,2);assert.equal(runtime.getConfig()?.featureFlags.demo,true);
});
