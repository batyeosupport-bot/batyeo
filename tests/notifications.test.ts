import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {RentalEngine,OVERDUE_LOSS_GRACE_MS} from '../core/rental';
import {planCustomerNotices,deliverNotices,planOpsDigest,warnedLongEnough,noticeAlreadySent,WARNING_LEAD_MS} from '../core/notifications';
import {resolveMailer,ResendMailer,type Mailer,type MailMessage} from '../core/mailer';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data),v=fn(next);validateData(next);this.data=next;return v;}}
class FakeMailer implements Mailer {sent:MailMessage[]=[];failNext=false;async send(m:MailMessage){if(this.failNext){this.failNext=false;throw new Error('provider down');}this.sent.push(m);}}
const HOUR=3_600_000;
const completed=(email:string|null)=>{const d=seedData('x');const e=new RentalEngine();const r=e.start(d,'c1','station-paris','k1',1_000,email??undefined);e.return(d,r.id,'station-paris',5_000);return {d,rental:d.rentals.find(x=>x.id===r.id)!};};

test('a receipt is due once, only for a customer who left an address, and the timeline never records the address',async()=>{
 const {d,rental}=completed('client@exemple.fr');
 const plan=planCustomerNotices(d).filter(n=>n.rentalId===rental.id);
 assert.equal(plan.length,1);assert.equal(plan[0].kind,'RECEIPT');assert.equal(plan[0].to,'client@exemple.fr');
 assert.match(plan[0].text,new RegExp(rental.id.slice(0,8).toUpperCase()));
 assert.equal(planCustomerNotices(completed(null).d).length,0,'no address, no mail — and no error');
 const repo=new MemoryRepository(d),mailer=new FakeMailer();
 assert.deepEqual(await deliverNotices(repo,mailer,9_000,new Set([rental.id])),{sent:1,failed:0});
 assert.deepEqual(await deliverNotices(repo,mailer,9_500,new Set([rental.id])),{sent:0,failed:0},'never twice');
 assert.equal(mailer.sent.length,1);
 const marker=repo.data.events.find(e=>e.rentalId===rental.id&&e.type==='NOTICE_SENT')!;
 assert.ok(!JSON.stringify(marker).includes('client@exemple.fr'),'partners can read this timeline, so it must not carry the customer’s address');
 assert.ok(noticeAlreadySent(repo.data,rental.id,'RECEIPT'));
});

test('a failed send records nothing so it is retried, instead of being lost',async()=>{
 const {d,rental}=completed('client@exemple.fr');const repo=new MemoryRepository(d),mailer=new FakeMailer();
 mailer.failNext=true;
 assert.deepEqual(await deliverNotices(repo,mailer,9_000,new Set([rental.id])),{sent:0,failed:1});
 assert.ok(!noticeAlreadySent(repo.data,rental.id,'RECEIPT'));
 assert.deepEqual(await deliverNotices(repo,mailer,10_000,new Set([rental.id])),{sent:1,failed:0});
});

test('an overdue rental is warned once with the exact date the deposit will be taken, and a lost one is told what happened',()=>{
 const d=seedData('x');const overdue=d.rentals.find(r=>r.state==='OVERDUE')!;overdue.contactEmail='retard@exemple.fr';
 const warn=planCustomerNotices(d).find(n=>n.rentalId===overdue.id)!;
 assert.equal(warn.kind,'OVERDUE_WARNING');
 assert.match(warn.text,/débitée/);
 assert.match(warn.text,/Si elle n’est pas rendue avant le .+, la caution de .+ sera intégralement débitée/,'the customer is given a real date, not a vague threat');
 overdue.state='LOST';
 assert.equal(planCustomerNotices(d).find(n=>n.rentalId===overdue.id)!.kind,'LOSS_NOTICE');
});

test('the ops digest exists only when something needs attention',()=>{
 const d=seedData('x');
 d.stations.forEach(s=>{s.online=true;});d.tickets=[];
 const quiet=planOpsDigest({...d,rentals:[],payments:[],events:[]},Date.now());
 assert.equal(quiet,null,'no mail on a quiet day');
 d.tickets.push({id:'t',partnerId:null,email:'x@y.fr',subject:'Problème',message:'Ma batterie ne sort pas',status:'OPEN',createdAt:1});
 const busy=planOpsDigest(d,Date.now())!;
 assert.match(busy.text,/demande\(s\) d’assistance ouverte/);
});

test('email is all-or-nothing at startup, and the API key never leaks into an error',async()=>{
 assert.equal(resolveMailer({}),undefined);
 assert.throws(()=>resolveMailer({RESEND_API_KEY:'re_x'}),/ensemble/);
 assert.throws(()=>resolveMailer({MAIL_FROM:'a@b.fr'}),/ensemble/);
 assert.throws(()=>resolveMailer({OPS_ALERT_EMAIL:'me@b.fr'}),/nécessite/);
 assert.throws(()=>resolveMailer({RESEND_API_KEY:'re_x',MAIL_FROM:'pas une adresse'}),/valide/);
 assert.equal(resolveMailer({RESEND_API_KEY:'re_x',MAIL_FROM:'BATYEO <noreply@batyeo.fr>',OPS_ALERT_EMAIL:'me@batyeo.fr'})!.opsEmail,'me@batyeo.fr');
 const calls:{url:string;body:string;auth:string}[]=[];
 await new ResendMailer('re_secret','noreply@batyeo.fr',async(url,init)=>{calls.push({url,body:init.body,auth:init.headers.Authorization});return {ok:true,status:200};}).send({to:'c@d.fr',subject:'S',text:'T'});
 assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].auth,'Bearer re_secret');
 assert.deepEqual(JSON.parse(calls[0].body),{from:'noreply@batyeo.fr',to:['c@d.fr'],subject:'S',text:'T'});
 await assert.rejects(new ResendMailer('re_secret','a@b.fr',async()=>({ok:false,status:403})).send({to:'c@d.fr',subject:'S',text:'T'}),(e:Error)=>/403/.test(e.message)&&!e.message.includes('re_secret'));
 await assert.rejects(new ResendMailer('re_secret','a@b.fr',async()=>{throw new Error('boom re_secret');}).send({to:'c@d.fr',subject:'S',text:'T'}),(e:Error)=>!e.message.includes('re_secret'));
});

test('cron: a customer we can email is warned first and never charged in the same run — a full day must pass',async()=>{
 const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='cron-secret';
 try{
  const d=seedData('x');const target=d.rentals.find(r=>r.state==='OVERDUE')!;
  const now=Date.now();
  // Push it past the 48 h grace window so it is eligible for capture right now.
  target.simulatedMinutes=Math.ceil((now-target.deadline!+OVERDUE_LOSS_GRACE_MS+HOUR)/60_000);
  target.contactEmail='retard@exemple.fr';
  for(const r of d.rentals)if(r.id!==target.id&&r.state==='OVERDUE')r.state='ACTIVE';
  const repo=new MemoryRepository(d),mailer=new FakeMailer();
  const run=()=>createApi(repo,{demo:false,allowLegacyCredentials:false},{mailConfig:{mailer,opsEmail:'ops@batyeo.fr'}}).GET(new Request('https://batyeo.test/api/core/internal/cron',{headers:{authorization:'Bearer cron-secret'}}),{params:Promise.resolve({path:['internal','cron']})});
  const first=await run();assert.equal(first.status,200);
  const body=await first.json() as {losses:unknown[];skippedUnwarned:number;notices:{sent:number}};
  assert.ok(mailer.sent.some(m=>m.to==='retard@exemple.fr'&&/rendue/.test(m.text)),'the warning went out');
  assert.equal(repo.data.rentals.find(r=>r.id===target.id)!.state!=='LOST',true,'and the deposit was NOT taken in the same run');
  assert.ok(body.skippedUnwarned>=1);
  assert.equal(warnedLongEnough(repo.data,repo.data.rentals.find(r=>r.id===target.id)!,now),false);
  // A day later the warning has aged enough: now, and only now, the capture is allowed.
  const later=repo.data.events.find(e=>e.rentalId===target.id&&e.type==='NOTICE_SENT')!;later.at-=WARNING_LEAD_MS+1;
  const second=await run();assert.equal(second.status,200);
  assert.equal(repo.data.rentals.find(r=>r.id===target.id)!.state,'LOST');
  assert.ok(mailer.sent.some(m=>m.subject.includes('caution a été débitée')),'the customer is told it happened');
 }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});

test('the rental page only asks for an address when a message can actually be sent',async()=>{
 const repo=new MemoryRepository(seedData('x'));
 const get=(mailConfig?:{mailer:Mailer;opsEmail:string|null})=>createApi(repo,{demo:false,allowLegacyCredentials:false},{mailConfig}).GET(new Request('https://batyeo.test/api/core/public'),{params:Promise.resolve({path:['public']})}).then(r=>r.json() as Promise<{emailEnabled:boolean}>);
 assert.equal((await get()).emailEnabled,false,'no sender configured, so no promise to write to anyone');
 assert.equal((await get({mailer:new FakeMailer(),opsEmail:null})).emailEnabled,true);
});

test('an open rental page reads the cabinet at most every 30 s — even when the cabinet is unplugged — and closes the rental the moment the battery is back',async()=>{
 const {linkManufacturerStation}=await import('../core/manufacturer-sync');
 const {ManufacturerError}=await import('../core/manufacturer');
 const d=seedData('x');const e=new RentalEngine();
 const token=crypto.randomUUID()+crypto.randomUUID();
 d.customerSessions.push({id:await (await import('../core/security')).sha256(token),customerId:'walker',expiresAt:Date.now()+100_000});
 const started=Date.now()-10*60_000;
 const rental=e.start(d,'walker','station-paris','k-walk',started);
 linkManufacturerStation(d,'station-paris','BAJIE','DTA1',started);
 const repo=new MemoryRepository(d);
 let reads=0,mode:'offline'|'back'='offline';
 const snapshot=(id:string)=>({deviceId:id,cabinetId:'c',qrCode:'q',online:true,totalSlots:2,emptySlots:1,busySlots:1,signal:'s',type:'t',ip:'1.1.1.1',shopId:'s',shopName:'n',shopAddress:'a',latitude:null,longitude:null,batteries:[{id:rental.batteryId!,slot:1,voltage:4100}],slots:[{position:1,battery:{id:rental.batteryId!,slot:1,voltage:4100}},{position:2,battery:null}],availability:1,lastSeenAt:null});
 const provider={listDevices:async()=>[],getDeviceInfo:async(id:string)=>{reads++;if(mode==='offline')throw new ManufacturerError('offline',504,'TIMEOUT');return snapshot(id);}};
 const poll=()=>createApi(repo,{demo:false,allowLegacyCredentials:false},{manufacturerProvider:provider}).GET(new Request('https://batyeo.test/api/core/customer',{headers:{cookie:`batyeo_customer=${token}`}}),{params:Promise.resolve({path:['customer']})}).then(r=>r.json() as Promise<{rental:{state:string}|null}>);
 for(let i=0;i<5;i++)await poll();
 assert.equal(reads,3,'a failing read is still retried by the sync itself (3 attempts) but only ONCE per 30 s window, not once per poll');
 // The battery comes back; wait out the gap by ageing the last attempt.
 mode='back';
 for(const run of repo.data.manufacturerSyncRuns)run.startedAt-=60_000;
 const after=await poll();
 assert.equal(after.rental!.state,'COMPLETED','the page the customer is looking at shows their receipt, with no webhook and no nightly job');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.returnStationId,'station-paris');
});
