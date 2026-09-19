import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {createPartner} from '../core/station-admin';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

test('createPartner creates the tenant and its first PARTNER_ADMIN login together, never one without the other',()=>{
 const d=emptyData();
 const {partner,user}=createPartner(d,{name:'Hôtel Central',city:'Marseille',adminEmail:'  Contact@Hotel-Central.fr  ',adminName:'Alex Dupont'},'hash-of-temp-password');
 assert.equal(d.partners.length,1);assert.equal(d.users.length,1);assert.equal(d.partnerUsers.length,1);
 assert.equal(partner.name,'Hôtel Central');assert.equal(partner.city,'Marseille');assert.equal(partner.commissionBps,null,'follows the pricing grid until an admin sets a rate');
 assert.equal(user.email,'contact@hotel-central.fr','trimmed and lowercased, so it matches how login looks it up');
 assert.equal(user.role,'PARTNER_ADMIN');assert.equal(user.partnerId,partner.id);assert.equal(user.passwordHash,'hash-of-temp-password');
 assert.equal(d.partnerUsers[0].userId,user.id);assert.equal(d.partnerUsers[0].partnerId,partner.id);
 validateData({...d,pricing:[{id:'p',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000}]} as Data);
});
test('createPartner refuses a duplicate email, case-insensitively, and leaves no partial state behind',()=>{
 const d=seedData('hash');
 const before={partners:d.partners.length,users:d.users.length,partnerUsers:d.partnerUsers.length};
 assert.throws(()=>createPartner(d,{name:'X',city:'Y',adminEmail:'ADMIN@BATYEO.DEMO',adminName:'Z'},'h'),/déjà utilisé/);
 assert.equal(d.partners.length,before.partners);assert.equal(d.users.length,before.users);assert.equal(d.partnerUsers.length,before.partnerUsers);
});
test('createPartner rejects blank or oversized fields',()=>{
 const d=emptyData();
 const valid={name:'N',city:'C',adminEmail:'a@b.fr',adminName:'A'};
 for(const bad of [{...valid,name:'  '},{...valid,city:''},{...valid,adminName:'   '},{...valid,adminEmail:'  '}]) assert.throws(()=>createPartner(d,bad,'h'));
 assert.equal(d.partners.length,0,'no partner created on any rejected attempt');
});

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body:unknown,token:string){
 const request=new Request(origin+'/api/core/'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)});
 return createApi(repo,{demo:true,allowLegacyCredentials:true},{}).POST(request,{params:Promise.resolve({path:path.split('/')})});
}
async function tokenFor(repo:MemoryRepository,role='SUPER_ADMIN'){
 const u=repo.data.users.find(u=>u.role===role)!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);
 repo.data.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+100000,authVersion:0});return token;
}

test('partner/create is reserved to BATYEO staff — a PARTNER_ADMIN cannot spin up a rival tenant',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const before=repo.data.partners.length;
 const r=await call(repo,'partner/create',{name:'Rival',city:'Nice',adminEmail:'rival@test.fr',adminName:'Rival Owner'},await tokenFor(repo,'PARTNER_ADMIN'));
 assert.equal(r.status,403);
 assert.equal(repo.data.partners.length,before,'no partner created on a refused request');
});
test('partner/create is refused for OPERATIONS/FINANCE/SUPPORT, allowed for ADMIN',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 for(const role of ['OPERATIONS','FINANCE','SUPPORT'] as const){
  const r=await call(repo,'partner/create',{name:'X',city:'Y',adminEmail:`x-${role}@test.fr`,adminName:'Z'},await tokenFor(repo,role));
  assert.equal(r.status,403,`${role} must be refused`);
 }
 const r=await call(repo,'partner/create',{name:'Nouveau Client',city:'Nice',adminEmail:'contact@nouveau-client.fr',adminName:'Sam Owner'},await tokenFor(repo,'ADMIN'));
 assert.equal(r.status,201);
});
test('partner/create returns a working, one-time-shown password that actually logs the new admin in',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const r=await call(repo,'partner/create',{name:'Nouveau Client',city:'Nice',adminEmail:'contact@nouveau-client.fr',adminName:'Sam Owner'},token);
 assert.equal(r.status,201);
 const body=await r.json() as {partner:{id:string;name:string};adminEmail:string;temporaryPassword:string};
 assert.equal(body.partner.name,'Nouveau Client');
 assert.equal(body.adminEmail,'contact@nouveau-client.fr');
 assert.match(body.temporaryPassword,/^[a-f0-9]{16}$/,'a real, usable secret — not a placeholder');
 const created=repo.data.users.find(u=>u.email==='contact@nouveau-client.fr')!;
 assert.equal(created.role,'PARTNER_ADMIN');assert.equal(created.partnerId,body.partner.id);
 const login=await call(repo,'login',{email:'contact@nouveau-client.fr',password:body.temporaryPassword},'');
 assert.equal(login.status,200,'the password shown to the admin must be the real one, not just a display placeholder');
 const rejected=await call(repo,'login',{email:'contact@nouveau-client.fr',password:'wrong-password'},'');
 assert.equal(rejected.status,401);
 const rejectedBody=await rejected.json() as {error:string};
 assert.match(rejectedBody.error,/incorrect/i);
});
test('partner/create refuses a second account on an already-used email, and leaves the audit trail readable',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const r=await call(repo,'partner/create',{name:'Doublon',city:'Lille',adminEmail:'admin@batyeo.demo',adminName:'Test'},token);
 assert.equal(r.status,409);
 const ok=await call(repo,'partner/create',{name:'Client Valide',city:'Lyon',adminEmail:'valide@client.fr',adminName:'Valide'},token);
 assert.equal(ok.status,201);
 assert.match(repo.data.audits.at(-1)!.action,/Partenaire créé.*Client Valide.*valide@client\.fr/);
});
