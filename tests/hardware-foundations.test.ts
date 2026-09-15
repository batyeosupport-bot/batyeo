import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDiscoveryReport,validateDiscoveryReport} from '../core/hardware-discovery';
import {RuntimeEnrollmentRegistry} from '../core/enrollment';
import {preflightHardwareCommand} from '../core/preflight';
import {emptyData,type Data} from '../core/types';
import type {Repository} from '../core/repository';
import {upsertRuntimeCredential,revokeRuntimeCredential,upsertStationCapability} from '../core/runtime-persistence';
class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(data:Data)=>T){const next=structuredClone(this.data);const value=fn(next);this.data=next;return value;}}
test('hardware discovery is non destructive and capabilities default unknown',()=>{const report=emptyDiscoveryReport(10);assert.equal(report.kioskMode,'UNKNOWN');assert.equal(validateDiscoveryReport(report),report);});
test('runtime enrollment is one time, scoped and rotatable',async()=>{const r=new RuntimeEnrollmentRegistry();const issued=await r.issue('station-a','partner-a',1000,0);const enrolled=await r.enroll(issued.tokenId,issued.rawToken,'runtime-a','fingerprint',1);assert.equal((await r.authenticate('runtime-a',enrolled.secret,2)).stationId,'station-a');await assert.rejects(()=>r.enroll(issued.tokenId,issued.rawToken,'runtime-b','f',3));const rotated=await r.rotate('runtime-a',4);await assert.rejects(()=>r.authenticate('runtime-a',enrolled.secret,5));assert.equal((await r.authenticate('runtime-a',rotated.secret,5)).version,2);r.revoke('runtime-a');await assert.rejects(()=>r.authenticate('runtime-a',rotated.secret));});
test('hardware preflight fails closed on disabled physical actions and unknown health',()=>{const result=preflightHardwareCommand({environment:'staging',physicalActionsEnabled:false,stationAllowlisted:true,operatorConfirmed:true,coreHealthy:true,dbHealthy:true,providerHealth:'UNKNOWN',stationOnline:true,availableBatteries:1,conflictingRental:false,criticalIncidents:0,commandId:'cmd'});assert.equal(result.result,'FAIL');assert.ok(result.failures.includes('physical-actions-disabled'));});
test('runtime persistence is idempotent and revocable',async()=>{const repo=new MemoryRepository(emptyData());const record={id:'cred-1',runtimeId:'runtime-1',stationId:'station-1',partnerId:'partner-1',digest:'digest',version:1,createdAt:1,lastUsedAt:null,revokedAt:null};await upsertRuntimeCredential(repo,record);await upsertRuntimeCredential(repo,record);assert.equal(repo.data.runtimeCredentials.length,1);assert.equal(await revokeRuntimeCredential(repo,'runtime-1',2),true);assert.equal(await revokeRuntimeCredential(repo,'runtime-1',3),false);await upsertStationCapability(repo,{id:'cap-1',stationId:'station-1',capability:'TOUCH',status:'SUPPORTED',source:'discovery',verifiedAt:1,evidence:null,version:null});await upsertStationCapability(repo,{id:'cap-2',stationId:'station-1',capability:'TOUCH',status:'UNKNOWN',source:'discovery',verifiedAt:2,evidence:null,version:null});assert.equal(repo.data.stationCapabilities.length,1);assert.equal(repo.data.stationCapabilities[0].status,'UNKNOWN');});

test('persisted runtime identity and revocation cannot be overwritten by stale writes',async()=>{
 const repo=new MemoryRepository(emptyData());
 const record={id:'c',runtimeId:'r',stationId:'s',partnerId:'p',digest:'first',version:1,createdAt:1,lastUsedAt:null,revokedAt:null};
 await upsertRuntimeCredential(repo,record);
 await assert.rejects(()=>upsertRuntimeCredential(repo,{...record,stationId:'foreign'}));
 await assert.rejects(()=>upsertRuntimeCredential(repo,{...record,digest:'changed'}));
 await upsertRuntimeCredential(repo,{...record,digest:'second',version:2});
 await assert.rejects(()=>upsertRuntimeCredential(repo,record));
 await revokeRuntimeCredential(repo,'r',3);
 await assert.rejects(()=>upsertRuntimeCredential(repo,{...record,digest:'second',version:2}));
 assert.equal(repo.data.runtimeCredentials[0].revokedAt,3);
});
