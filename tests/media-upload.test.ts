import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {createMedia} from '../core/media-admin';
import {createStation} from '../core/station-admin';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';
import type {HandleUploadBody, handleUpload as HandleUploadFn} from '@vercel/blob/client';

function venue(){const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});return d;}

test('createMedia derives a stable checksum from the URI when none is given, and uses the given one otherwise',()=>{
 const d=venue();
 const a=createMedia(d,{name:'A',kind:'IMAGE',uri:'https://cdn.test/a.png',durationMs:5000});
 const b=createMedia(d,{name:'B',kind:'IMAGE',uri:'https://cdn.test/a.png',durationMs:5000});
 assert.equal(a.checksum,b.checksum,'same URI, no explicit checksum → same fingerprint');
 const c=createMedia(d,{name:'C',kind:'IMAGE',uri:'https://cdn.test/different.png',durationMs:5000});
 assert.notEqual(a.checksum,c.checksum);
 const withEtag=createMedia(d,{name:'D',kind:'IMAGE',uri:'https://cdn.test/a.png',durationMs:5000,checksum:'"blob-etag-123"'});
 assert.equal(withEtag.checksum,'"blob-etag-123"','an explicit checksum (the upload’s real ETag) always wins');
});

test('createMedia validates the scheduling window and rejects an end before the start',()=>{
 const d=venue();
 const scheduled=createMedia(d,{name:'Noël',kind:'IMAGE',uri:'https://cdn.test/noel.png',durationMs:5000,startsAt:1000,endsAt:2000});
 assert.equal(scheduled.startsAt,1000);assert.equal(scheduled.endsAt,2000);
 assert.throws(()=>createMedia(d,{name:'Bad',kind:'IMAGE',uri:'https://cdn.test/x.png',durationMs:5000,startsAt:2000,endsAt:1000}),/fin doit être après/);
 assert.throws(()=>createMedia(d,{name:'Same',kind:'IMAGE',uri:'https://cdn.test/x.png',durationMs:5000,startsAt:1000,endsAt:1000}),/fin doit être après/);
 assert.doesNotThrow(()=>createMedia(d,{name:'OpenEnded',kind:'IMAGE',uri:'https://cdn.test/y.png',durationMs:5000,startsAt:1000,endsAt:null}));
 validateData({...d,pricing:[]} as Data);
});

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body:unknown,token:string,deps:Parameters<typeof createApi>[2]={}){
 const request=new Request(origin+'/api/core/'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)});
 return createApi(repo,{demo:true,allowLegacyCredentials:true},deps).POST(request,{params:Promise.resolve({path:path.split('/')})});
}
async function tokenFor(repo:MemoryRepository,role='SUPER_ADMIN'){
 const u=repo.data.users.find(u=>u.role===role)!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);
 repo.data.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+100000,authVersion:0});return token;
}
/** A fake handleUpload that behaves like @vercel/blob/client's real one just enough to exercise our onBeforeGenerateToken logic, without any network call or BLOB_READ_WRITE_TOKEN. */
function fakeHandleUpload(capture:{pathname?:string;clientPayload?:string|null;options?:unknown}){
 return async({body,onBeforeGenerateToken}:{body:HandleUploadBody;onBeforeGenerateToken:(pathname:string,clientPayload:string|null,multipart:boolean)=>Promise<unknown>})=>{
  const payload=(body as {payload:{pathname:string;clientPayload:string|null;multipart:boolean}}).payload;
  capture.pathname=payload.pathname;capture.clientPayload=payload.clientPayload;
  capture.options=await onBeforeGenerateToken(payload.pathname,payload.clientPayload,payload.multipart);
  return {type:'blob.generate-client-token' as const,clientToken:'fake-token'};
 };
}
const tokenRequestBody=(kind:string)=>({type:'blob.generate-client-token',payload:{pathname:'promo.mp4',callbackUrl:origin+'/api/core/media/upload-token',clientPayload:kind,multipart:false}});

test('media/upload-token requires the settings capability, same as media/create',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const capture:{options?:unknown}={};
 const deps={handleMediaUpload:fakeHandleUpload(capture) as unknown as typeof HandleUploadFn};
 for(const role of ['OPERATIONS','SUPPORT','FINANCE'] as const){
  const r=await call(repo,'media/upload-token',tokenRequestBody('IMAGE'),await tokenFor(repo,role),deps);
  assert.equal(r.status,403,`${role} must be refused`);
 }
 const ok=await call(repo,'media/upload-token',tokenRequestBody('IMAGE'),await tokenFor(repo),deps);
 assert.equal(ok.status,200);
 assert.deepEqual(await ok.json(),{type:'blob.generate-client-token',clientToken:'fake-token'});
});

test('media/upload-token restricts content types and size by the declared kind',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const imageCapture:{options?:unknown}={};
 await call(repo,'media/upload-token',tokenRequestBody('IMAGE'),token,{handleMediaUpload:fakeHandleUpload(imageCapture) as unknown as typeof HandleUploadFn});
 assert.deepEqual(imageCapture.options,{allowedContentTypes:['image/jpeg','image/png','image/webp','image/gif'],maximumSizeInBytes:15*1024*1024,addRandomSuffix:true});
 const videoCapture:{options?:unknown}={};
 await call(repo,'media/upload-token',tokenRequestBody('VIDEO'),token,{handleMediaUpload:fakeHandleUpload(videoCapture) as unknown as typeof HandleUploadFn});
 assert.deepEqual(videoCapture.options,{allowedContentTypes:['video/mp4','video/webm','video/quicktime'],maximumSizeInBytes:150*1024*1024,addRandomSuffix:true});
});

test('media/upload-token surfaces a clear DomainError instead of an opaque 503 when Blob itself fails (e.g. not provisioned)',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const failing=(async()=>{throw new Error('No token found. Either configure the BLOB_READ_WRITE_TOKEN environment variable');})as unknown as typeof HandleUploadFn;
 const r=await call(repo,'media/upload-token',tokenRequestBody('IMAGE'),token,{handleMediaUpload:failing});
 assert.equal(r.status,503);
 const d=await r.json() as {error:string};
 assert.match(d.error,/BLOB_READ_WRITE_TOKEN/,'the real cause is surfaced, not a generic message');
});

test('media/create accepts the checksum an upload returns and stores it verbatim',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const station=createStation(repo.data,{partnerId:'partner-a',venueId:'venue-paris',publicId:'checksum-test',capacity:1});
 const r=await call(repo,'media/create',{name:'Promo',kind:'VIDEO',uri:'https://xyz.public.blob.vercel-storage.com/promo-abc123.mp4',checksum:'"real-etag-from-blob"',durationMs:8000,targetStationIds:[station.id]},token);
 assert.equal(r.status,201);
 const created=repo.data.media.find(m=>m.name==='Promo');
 assert.equal(created?.checksum,'"real-etag-from-blob"');
});
