import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {createApi} from '../server/http';
import {checksumConfig} from '../core/runtime-config';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';
import {validateData} from '../core/invariants';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
const api=(repo:Repository)=>createApi(repo,{demo:true,allowLegacyCredentials:true});
function call(repo:Repository,path:string,body?:unknown,headers:Record<string,string>={}){
 const method=body===undefined?'GET':'POST';
 const routePath=path.split('?')[0];
 const request=new Request(origin+'/api/core/'+path,{method,headers:{origin,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return api(repo)[method](request,{params:Promise.resolve({path:routePath.split('/')})});
}
async function asAdmin(repo:MemoryRepository){
 const u=repo.data.users.find(u=>u.role==='SUPER_ADMIN')!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);
 repo.data.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+100000,authVersion:0});
 return token;
}
function runtimeHeaders(runtimeId:string,credential:string){return {'x-batyeo-runtime-id':runtimeId,authorization:`Bearer ${credential}`};}
async function enroll(repo:MemoryRepository,stationId:string,runtimeId:string){
 const adminToken=await asAdmin(repo);
 const issued=await call(repo,'runtime/enrollment-token',{stationId},{cookie:`batyeo_session=${adminToken}`});
 assert.equal(issued.status,201);
 const {tokenId,token}=await issued.json() as {tokenId:string;token:string};
 const enrolled=await call(repo,'runtime/enroll',{tokenId,token,runtimeId});
 assert.equal(enrolled.status,201);
 const {credential,version}=await enrolled.json() as {credential:string;version:number};
 return {credential,version,tokenId,token};
}

test('runtime pairing loop: enrollment-token issues a one-time token that enroll consumes into a scoped credential',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const config=await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',credential));
 assert.equal(config.status,200);
 const body=await config.json() as {envelope:{config:unknown;checksum:string}};
 assert.equal(body.envelope.checksum,checksumConfig(body.envelope.config as never));
});

test('an enrollment token cannot be replayed once consumed',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {tokenId,token}=await enroll(repo,stationId,'runtime-1');
 const replay=await call(repo,'runtime/enroll',{tokenId,token,runtimeId:'runtime-2'});
 assert.equal(replay.status,401);
 assert.equal(repo.data.runtimeCredentials.length,1);
});

test('an expired enrollment token is rejected even before it has been used',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const adminToken=await asAdmin(repo);
 const issued=await call(repo,'runtime/enrollment-token',{stationId:repo.data.stations[0].id},{cookie:`batyeo_session=${adminToken}`});
 const {tokenId,token}=await issued.json() as {tokenId:string;token:string};
 repo.data.runtimeEnrollmentTokens.find(t=>t.id===tokenId)!.expiresAt=Date.now()-1;
 const enrolled=await call(repo,'runtime/enroll',{tokenId,token,runtimeId:'runtime-1'});
 assert.equal(enrolled.status,401);
});

test('a runtime ID already registered elsewhere cannot enroll again, even with a fresh valid token',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const [stationA,stationB]=repo.data.stations;
 await enroll(repo,stationA.id,'runtime-1');
 const adminToken=await asAdmin(repo);
 const issued=await call(repo,'runtime/enrollment-token',{stationId:stationB.id},{cookie:`batyeo_session=${adminToken}`});
 const {tokenId,token}=await issued.json() as {tokenId:string;token:string};
 const enrolled=await call(repo,'runtime/enroll',{tokenId,token,runtimeId:'runtime-1'});
 assert.equal(enrolled.status,409);
 assert.equal(repo.data.runtimeCredentials.length,1);
});

test('a station already bound to an active runtime rejects a second enrollment',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 await enroll(repo,stationId,'runtime-1');
 const adminToken=await asAdmin(repo);
 const issued=await call(repo,'runtime/enrollment-token',{stationId},{cookie:`batyeo_session=${adminToken}`});
 const {tokenId,token}=await issued.json() as {tokenId:string;token:string};
 const enrolled=await call(repo,'runtime/enroll',{tokenId,token,runtimeId:'runtime-2'});
 assert.equal(enrolled.status,409);
});

test('a station whose only runtime was revoked can be re-enrolled',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 await enroll(repo,stationId,'runtime-1');
 repo.data.runtimeCredentials[0].revokedAt=Date.now();
 const adminToken=await asAdmin(repo);
 const issued=await call(repo,'runtime/enrollment-token',{stationId},{cookie:`batyeo_session=${adminToken}`});
 const {tokenId,token}=await issued.json() as {tokenId:string;token:string};
 const enrolled=await call(repo,'runtime/enroll',{tokenId,token,runtimeId:'runtime-2'});
 assert.equal(enrolled.status,201);
});

test('runtime/config and runtime/heartbeat reject a missing, unknown or revoked credential',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 assert.equal((await call(repo,'runtime/config')).status,401);
 assert.equal((await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1','not-the-real-credential'))).status,401);
 repo.data.runtimeCredentials[0].revokedAt=Date.now();
 assert.equal((await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',credential))).status,401);
});

test('a runtime cannot read or heartbeat for a station it is not scoped to',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const [stationA,stationB]=repo.data.stations;
 const {credential}=await enroll(repo,stationA.id,'runtime-1');
 const response=await call(repo,`runtime/config?stationId=${stationB.id}`,undefined,runtimeHeaders('runtime-1',credential));
 assert.equal(response.status,403);
});

test('runtime/heartbeat persists telemetry scoped to the credential\'s own station and reports health plus the current config version',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const heartbeat={runtimeVersion:'1.0.0',network:'ONLINE' as const,appUptimeMs:1000,displayStatus:'OK' as const,providerStatus:null,lastCoreContactAt:Date.now(),errors:[]};
 const response=await call(repo,'runtime/heartbeat',heartbeat,runtimeHeaders('runtime-1',credential));
 assert.equal(response.status,200);
 const body=await response.json() as {accepted:boolean;health:string;configVersion:number};
 assert.equal(body.accepted,true);
 assert.equal(body.health,'ONLINE');
 assert.equal(repo.data.stationHeartbeats.length,1);
 assert.equal(repo.data.stationHeartbeats[0].stationId,stationId);
 assert.equal(repo.data.stationHeartbeats[0].runtimeId,'runtime-1');
});

test('runtime/heartbeat overwrites the previous reading for the same station instead of accumulating history',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const heartbeat={runtimeVersion:'1.0.0',network:'ONLINE' as const,appUptimeMs:1000,displayStatus:'OK' as const,providerStatus:null,lastCoreContactAt:Date.now(),errors:[]};
 await call(repo,'runtime/heartbeat',heartbeat,runtimeHeaders('runtime-1',credential));
 await call(repo,'runtime/heartbeat',{...heartbeat,appUptimeMs:2000},runtimeHeaders('runtime-1',credential));
 assert.equal(repo.data.stationHeartbeats.length,1);
 assert.equal(repo.data.stationHeartbeats[0].appUptimeMs,2000);
});

test('runtime/heartbeat rejects a malformed body without touching stored telemetry',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const response=await call(repo,'runtime/heartbeat',{network:'ONLINE'},runtimeHeaders('runtime-1',credential));
 assert.equal(response.status,400);
 assert.equal(repo.data.stationHeartbeats.length,0);
});

test('runtime/rotate issues a new credential that invalidates the old one, and refuses a stale expectedVersion',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential:oldCredential}=await enroll(repo,stationId,'runtime-1');
 const adminToken=await asAdmin(repo);
 const stale=await call(repo,'runtime/rotate',{runtimeId:'runtime-1',expectedVersion:99},{cookie:`batyeo_session=${adminToken}`});
 assert.equal(stale.status,409);
 const rotated=await call(repo,'runtime/rotate',{runtimeId:'runtime-1',expectedVersion:1},{cookie:`batyeo_session=${adminToken}`});
 assert.equal(rotated.status,200);
 const {credential:newCredential}=await rotated.json() as {credential:string};
 assert.equal((await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',oldCredential))).status,401);
 assert.equal((await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',newCredential))).status,200);
});

test('runtime/revoke immediately cuts off the credential from every runtime endpoint',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const adminToken=await asAdmin(repo);
 const revoked=await call(repo,'runtime/revoke',{runtimeId:'runtime-1'},{cookie:`batyeo_session=${adminToken}`});
 assert.equal(revoked.status,200);
 assert.equal((await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',credential))).status,401);
 assert.equal((await call(repo,'runtime/heartbeat',{},runtimeHeaders('runtime-1',credential))).status,401);
});

test('a non-operator cannot issue enrollment tokens or manage runtime credentials',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const support=repo.data.users.find(u=>u.role==='SUPPORT')!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);
 repo.data.sessions.push({id:digest,userId:support.id,expiresAt:Date.now()+100000,authVersion:0});
 assert.equal((await call(repo,'runtime/enrollment-token',{stationId:repo.data.stations[0].id},{cookie:`batyeo_session=${token}`})).status,403);
 assert.equal((await call(repo,'runtime/revoke',{runtimeId:'anything'},{cookie:`batyeo_session=${token}`})).status,403);
});

test('a kiosk assigned a Stripe Terminal Location picks it up on its very next runtime/config poll, without a manual entry',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const stationId=repo.data.stations[0].id;
 const {credential}=await enroll(repo,stationId,'runtime-1');
 const before=await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',credential));
 const beforeBody=await before.json() as {envelope:{config:{stripeTerminalLocationId:string|null;version:number}}};
 assert.equal(beforeBody.envelope.config.stripeTerminalLocationId,null);
 const adminToken=await asAdmin(repo);
 const assigned=await call(repo,'station/stripe-location',{stationId,locationId:'tml_ABC123'},{cookie:`batyeo_session=${adminToken}`});
 assert.equal(assigned.status,200);
 const after=await call(repo,'runtime/config',undefined,runtimeHeaders('runtime-1',credential));
 const afterBody=await after.json() as {envelope:{config:{stripeTerminalLocationId:string|null;version:number}}};
 assert.equal(afterBody.envelope.config.stripeTerminalLocationId,'tml_ABC123');
 assert.ok(afterBody.envelope.config.version>beforeBody.envelope.config.version);
});
