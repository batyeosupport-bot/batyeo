import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {RentalEngine} from '../core/rental';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

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
const rateOf=(repo:MemoryRepository)=>repo.data.partners.find(p=>p.id==='partner-a')!.commissionBps;

test('partner/set-commission enregistre un palier, le journalise et revient à la grille',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const ok=await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps:500},token);
 assert.equal(ok.status,200);
 assert.equal(rateOf(repo),500);
 assert.match(repo.data.audits.at(-1)!.action,/Commission partenaire.*5 %/);
 const back=await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps:null},token);
 assert.equal(back.status,200);
 assert.equal(rateOf(repo),null);
 assert.match(repo.data.audits.at(-1)!.action,/taux de la grille/);
});

test('partner/set-commission refuse un taux hors paliers et un partenaire inconnu',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 for(const commissionBps of [1234,-500,20000,'2000']){
  const r=await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps},token);
  assert.equal(r.status,400,`taux refusé : ${commissionBps}`);
 }
 assert.equal((await call(repo,'partner/set-commission',{partnerId:'inconnu',commissionBps:500},token)).status,404);
 assert.equal(rateOf(repo),null,'aucun refus ne modifie le taux');
});

test('un PARTNER_ADMIN ne peut pas régler sa propre commission',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 for(const role of ['PARTNER_ADMIN','OPERATIONS','SUPPORT'] as const){
  const r=await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps:0},await tokenFor(repo,role));
  assert.equal(r.status,403,`${role} doit être refusé`);
 }
 assert.equal(rateOf(repo),null);
 assert.equal((await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps:0},await tokenFor(repo,'FINANCE'))).status,200);
 assert.equal(rateOf(repo),0);
});

test('le taux réglé par la route est celui que facture la location suivante',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 await call(repo,'partner/set-commission',{partnerId:'partner-a',commissionBps:3000},token);
 const now=Date.now(),engine=new RentalEngine();
 const rental=await repo.transaction(d=>{const r=engine.start(d,'client-http','station-paris','k-http',now);engine.return(d,r.id,'station-paris',now+61*60000);return r;});
 assert.equal(rental.amountCents,400);
 assert.equal(rental.commissionCents,120,'30 % du montant, et non les 20 % de la grille');
});
