import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../core/security';
import {seedData} from '../core/seed';
import {createApi} from '../server/http';
import {parisClock,promoLiveAt,promoScheduleLabel,type VenuePromo} from '../core/screen';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';
import {validateData} from '../core/invariants';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body?:unknown,token?:string){
 const request=new Request(origin+'/api/core/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:token?`batyeo_session=${token}`:''},body:body===undefined?undefined:JSON.stringify(body)});
 return createApi(repo,{demo:true,allowLegacyCredentials:true})[body===undefined?'GET':'POST'](request,{params:Promise.resolve({path:path.split('/')})});
}
async function login(data:Data,role:string,partnerId?:string){
 const user=data.users.find(u=>u.role===role&&(!partnerId||u.partnerId===partnerId))!;const token=crypto.randomUUID()+crypto.randomUUID();
 data.sessions.push({id:await sha256(token),userId:user.id,expiresAt:Date.now()+100_000,authVersion:0});return token;
}
const promoBody=(venueId:string,extra:Record<string,unknown>={})=>({venueId,title:'Happy hour',subtitle:'Pintes et cocktails',highlight:'Pinte à 5 €',imageUrl:null,days:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440,startsAt:null,endsAt:null,durationMs:8000,...extra});

test('BATYEO dresses a venue and schedules its promo; the station screen receives both, publicly',async()=>{
 const data=seedData('x');const admin=await login(data,'SUPER_ADMIN');const repo=new MemoryRepository(data);
 const station=data.stations.find(s=>s.publicId==='paris-demo')!;
 const branding=await call(repo,'venue/branding',{venueId:station.venueId,theme:'sport',logoUrl:'https://cdn.test/logo.png',backgroundUrl:null,locales:['en-GB','fr-FR'],copy:{'fr-FR':{headlines:['Le match n’est pas fini.',' '],tagline:''}}},admin);
 assert.equal(branding.status,200);
 const created=await call(repo,'promo/save',promoBody(station.venueId),admin);assert.equal(created.status,201);
 const {promo}=await created.json() as {promo:{id:string;status:string}};assert.equal(promo.status,'DRAFT');
 let screen=await (await call(repo,'display/paris-demo')).json() as {poster:{branding:{locales:string[];accent:string;copy:Record<string,{headlines:string[]}>};promos:unknown[]}};
 assert.deepEqual(screen.poster.branding.locales,['fr-FR','en-GB'],'French stays the resting language, first');
 assert.equal(screen.poster.branding.accent,'#b6ff3b');
 assert.deepEqual(screen.poster.branding.copy['fr-FR'].headlines,['Le match n’est pas fini.']);
 assert.equal(screen.poster.promos.length,0,'a draft never reaches the screen');
 assert.equal((await call(repo,'promo/publish',{id:promo.id},admin)).status,200);
 screen=await (await call(repo,'display/paris-demo')).json() as typeof screen;
 assert.equal(screen.poster.promos.length,1);
});

test('a venue never writes its own screen: branding, promos and partner records are BATYEO staff only',async()=>{
 const data=seedData('x');const partner=await login(data,'PARTNER_ADMIN','partner-a');const support=await login(data,'SUPPORT');const repo=new MemoryRepository(data);
 const venue=data.venues.find(v=>v.partnerId==='partner-a')!;
 assert.equal((await call(repo,'venue/branding',{venueId:venue.id,theme:'sport',logoUrl:null,backgroundUrl:null,locales:['fr-FR'],copy:{}},partner)).status,403);
 assert.equal((await call(repo,'promo/save',promoBody(venue.id),partner)).status,403);
 const profile={partnerId:'partner-a',legalName:'SAS Bar',siret:'12345678901234',billingAddress:'1 rue X',contactName:'A',contactEmail:'a@bar.fr',contactPhone:'0600000000',iban:'FR76 3000 6000 0112 3456 7890 189',contractStartedAt:null};
 assert.equal((await call(repo,'partner/profile',profile,partner)).status,403,'a partner changing its own IBAN would divert its commissions');
 assert.equal((await call(repo,'partner/profile',profile,support)).status,403);
 assert.equal(repo.data.venues.find(v=>v.id===venue.id)!.branding??null,null);
 assert.equal(repo.data.promos.length,0);
});

test('a venue can only ask for a promo: it lands in the support inbox, scoped to its own venues',async()=>{
 const data=seedData('x');const partner=await login(data,'PARTNER_ADMIN','partner-a');const repo=new MemoryRepository(data);
 const own=data.venues.find(v=>v.partnerId==='partner-a')!,other=data.venues.find(v=>v.partnerId==='partner-b')!;
 const asked=await call(repo,'promo/request',{venueId:own.id,offer:'Pinte à 5 €',when:'Samedi 20h, soirée match'},partner);
 assert.equal(asked.status,201);
 assert.match(repo.data.tickets.at(-1)!.subject,/Demande de promo/);
 assert.equal(repo.data.promos.length,0,'nothing reaches the screen by itself');
 assert.equal((await call(repo,'promo/request',{venueId:other.id,offer:'Pinte à 5 €',when:'Samedi'},partner)).status,404);
});

test('the partner record keeps the IBAN normalized and hides it from staff without finance access',async()=>{
 const data=seedData('x');const admin=await login(data,'SUPER_ADMIN');const ops=await login(data,'OPERATIONS');const repo=new MemoryRepository(data);
 const saved=await call(repo,'partner/profile',{partnerId:'partner-a',legalName:'SAS Bar',siret:'12345678901234',billingAddress:'1 rue X',contactName:'A',contactEmail:'a@bar.fr',contactPhone:'0600000000',iban:'fr76 3000 6000 0112 3456 7890 189',contractStartedAt:1_700_000_000_000},admin);
 assert.equal(saved.status,200);
 assert.equal(repo.data.partners.find(p=>p.id==='partner-a')!.iban,'FR7630006000011234567890189');
 assert.equal((await call(repo,'partner/profile',{partnerId:'partner-a',legalName:'',siret:'123',billingAddress:'',contactName:'',contactEmail:'',contactPhone:'',iban:'',contractStartedAt:null},admin)).status,400,'a SIRET is 14 digits');
 const opsView=await (await call(repo,'dashboard',undefined,ops)).json() as {partners:{id:string;iban?:string;siret:string}[]};
 const row=opsView.partners.find(p=>p.id==='partner-a')!;
 assert.equal(row.iban,undefined);assert.equal(row.siret,'12345678901234');
});

test('a promo follows Paris time — summer and winter — and a window may cross midnight',()=>{
 const base:VenuePromo={id:'p',venueId:'v',title:'t',subtitle:'',highlight:'',imageUrl:null,days:[5],startMinute:18*60,endMinute:20*60,startsAt:null,endsAt:null,durationMs:8000,status:'PUBLISHED',createdAt:0,updatedAt:0};
 const summerFriday19h=Date.UTC(2026,6,17,17,0);// 19h in Paris (UTC+2)
 const winterFriday19h=Date.UTC(2026,11,18,18,0);// 19h in Paris (UTC+1)
 assert.deepEqual(parisClock(summerFriday19h),{day:5,minute:19*60});
 assert.ok(promoLiveAt(base,summerFriday19h));assert.ok(promoLiveAt(base,winterFriday19h));
 assert.equal(promoLiveAt(base,Date.UTC(2026,6,17,19,0)),false,'21h is over');
 assert.equal(promoLiveAt({...base,status:'DRAFT'},summerFriday19h),false);
 const lateNight={...base,startMinute:22*60,endMinute:2*60};
 assert.ok(promoLiveAt(lateNight,Date.UTC(2026,6,17,21,30)),'Friday 23h30');
 assert.ok(promoLiveAt(lateNight,Date.UTC(2026,6,17,23,30)),'Saturday 1h30 still belongs to Friday night');
 assert.equal(promoLiveAt(lateNight,Date.UTC(2026,6,18,21,30)),false,'Saturday 23h30 is not scheduled');
 assert.equal(promoScheduleLabel({days:[1,2,3,4,5],startMinute:1080,endMinute:1200}),'Lun–Ven · 18h–20h');
 assert.equal(promoScheduleLabel({days:[0,1,2,3,4,5,6],startMinute:1290,endMinute:120}),'Tous les jours · 21h30–2h');
 assert.equal(promoScheduleLabel({days:[5,6],startMinute:1200,endMinute:1380}),'Ven, Sam · 20h–23h');
});
