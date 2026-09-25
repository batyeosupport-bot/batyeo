import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {OVERDUE_LOSS_GRACE_MS,MAX_DEADLINE_HOURS,STRIPE_AUTHORIZATION_LIFETIME_MS,WARNING_LEAD_MS} from '../core/rental';
import {applyStripeWebhook} from '../core/stripe-coordinator';
import {evaluateAlerts} from '../core/ops-alerts';
import {purgeExpiredRecords,SYNC_RUN_RETENTION_MS} from '../core/retention';
import {createApi} from '../server/http';
import {createPasswordHash} from '../core/security';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data),v=fn(next);validateData(next);this.data=next;return v;}}
const HOUR=3_600_000;

test('charge.succeeded fires at authorization for a manual capture: it must never be read as the deposit being taken',()=>{
 const d=seedData('x');const rental=d.rentals.find(r=>r.state==='ACTIVE')!;const payment=d.payments.find(p=>p.rentalId===rental.id)!;
 payment.provider='stripe';payment.providerReference='pi_real';payment.status='AUTHORIZED';payment.authorizedCents=2000;payment.capturedCents=0;payment.releasedCents=0;
 // The Charge object of an uncaptured authorization: same metadata as the intent, `ch_` id, full amount, nothing captured.
 const result=applyStripeWebhook(d,{id:'evt-charge',type:'charge.succeeded',data:{object:{id:'ch_auth',object:'charge',payment_intent:'pi_real',amount:2000,amount_captured:0,captured:false,metadata:{rentalId:rental.id}}}});
 assert.deepEqual(result,{ignored:true});
 assert.equal(payment.status,'AUTHORIZED','still only authorized');
 assert.equal(payment.capturedCents,0);
 assert.equal(payment.providerReference,'pi_real','the intent reference refunds and disputes rely on is kept');
});

test('the legacy capture job obeys the same rule as the nightly one: no deposit taken without a warning delivered a day before',async()=>{
 const previous=process.env.OVERDUE_CAPTURE_SECRET;process.env.OVERDUE_CAPTURE_SECRET='capture-secret';
 try{
  const d=seedData('x');const target=d.rentals.find(r=>r.state==='OVERDUE')!;const now=Date.now();
  target.simulatedMinutes=Math.ceil((now-target.deadline!+OVERDUE_LOSS_GRACE_MS+HOUR)/60_000);
  for(const r of d.rentals)if(r.id!==target.id&&r.state==='OVERDUE')r.state='ACTIVE';
  const repo=new MemoryRepository(d);
  const run=()=>createApi(repo,{demo:false,allowLegacyCredentials:false}).POST(new Request('https://batyeo.test/api/core/internal/rentals/capture-overdue-losses',{method:'POST',headers:{authorization:'Bearer capture-secret'}}),{params:Promise.resolve({path:['internal','rentals','capture-overdue-losses']})});
  const unwarned=await run();assert.equal(unwarned.status,200);
  assert.equal(((await unwarned.json()) as {processed:number}).processed,0);
  assert.equal(repo.data.rentals.find(r=>r.id===target.id)!.state,'OVERDUE','never warned: not charged');
  repo.data.events.push({id:'warned',rentalId:target.id,at:now-WARNING_LEAD_MS-1,type:'NOTICE_SENT',detail:'OVERDUE_WARNING · message envoyé au client'});
  const warned=await run();assert.equal(((await warned.json()) as {processed:number}).processed,1);
  assert.equal(repo.data.rentals.find(r=>r.id===target.id)!.state,'LOST');
 }finally{if(previous===undefined)delete process.env.OVERDUE_CAPTURE_SECRET;else process.env.OVERDUE_CAPTURE_SECRET=previous;}
});

test('a lost battery held back for lack of a warning is flagged as NOT charged, with the days left before Stripe drops the hold',()=>{
 const d=seedData('x');const target=d.rentals.find(r=>r.state==='OVERDUE')!;const now=target.createdAt+5*86_400_000;
 target.simulatedMinutes=Math.ceil((now-target.deadline!+OVERDUE_LOSS_GRACE_MS+HOUR)/60_000);
 const alert=evaluateAlerts(d,now).find(a=>a.id===`overdue-${target.id}`)!;
 assert.equal(alert.severity,'CRITICAL');
 assert.match(alert.message,/NON encaissée/);
 assert.match(alert.message,/dans 2 jour\(s\)/);
});

test('the return deadline cannot be set so long that the card hold expires before a lost battery can be charged',async()=>{
 // Worst case: warned by the first nightly run after the deadline (≤ 24 h), so the warning is a day old by the 48 h mark;
 // the capture then waits at most one more nightly run. A day of margin must remain under Stripe's 7 days.
 assert.ok((MAX_DEADLINE_HOURS+48+24+24)*HOUR<=STRIPE_AUTHORIZATION_LIFETIME_MS);
 const d=seedData('x');const admin=d.users.find(u=>u.role==='SUPER_ADMIN')!;admin.passwordHash=await createPasswordHash('long-password-2026');
 const repo=new MemoryRepository(d);const api=createApi(repo,{demo:false,allowLegacyCredentials:false});
 const login=await api.POST(new Request('https://batyeo.test/api/core/login',{method:'POST',headers:{origin:'https://batyeo.test','content-type':'application/json'},body:JSON.stringify({email:admin.email,password:'long-password-2026'})}),{params:Promise.resolve({path:['login']})});
 assert.equal(login.status,200);
 const session=login.headers.get('set-cookie')!.split(';')[0];
 const setPricing=(deadlineHours:number)=>api.POST(new Request('https://batyeo.test/api/core/pricing',{method:'POST',headers:{origin:'https://batyeo.test','content-type':'application/json',cookie:session},body:JSON.stringify({hourlyCents:200,capCents:800,depositCents:2000,deadlineHours,commissionBps:2000})}),{params:Promise.resolve({path:['pricing']})});
 assert.equal((await setPricing(MAX_DEADLINE_HOURS+1)).status,400);
 assert.equal((await setPricing(MAX_DEADLINE_HOURS)).status,200);
});

test('the nightly job drops what has expired, and keeps every rental, audit row and a running sync',()=>{
 const d=seedData('x');const now=1_900_000_000_000;
 d.customerSessions=[{id:'old',customerId:'c-old',expiresAt:now-1},{id:'live',customerId:'c-live',expiresAt:now+1}];
 d.manufacturerSyncRuns=[
  {id:'stale',provider:'BAJIE',trigger:'ON_DEMAND',requestedBy:null,startedAt:now-SYNC_RUN_RETENTION_MS-1,completedAt:now-SYNC_RUN_RETENTION_MS,status:'FAILED',total:1,succeeded:0,failed:1,mismatches:0,errorSummary:[]},
  {id:'recent',provider:'BAJIE',trigger:'ON_DEMAND',requestedBy:null,startedAt:now-1000,completedAt:now-500,status:'COMPLETED',total:1,succeeded:1,failed:0,mismatches:0,errorSummary:[]},
 ];
 const rentals=d.rentals.length,audits=d.audits.length;
 assert.ok(purgeExpiredRecords(d,now)>=2);
 assert.deepEqual(d.customerSessions.map(s=>s.id),['live']);
 assert.deepEqual(d.manufacturerSyncRuns.map(r=>r.id),['recent']);
 assert.equal(d.rentals.length,rentals);assert.equal(d.audits.length,audits);
 validateData(d);
});
