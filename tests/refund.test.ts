import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {sha256} from '../core/security';
import {RentalEngine} from '../core/rental';
import {StripeRentalCoordinator,applyStripeWebhook} from '../core/stripe-coordinator';
import {evaluateAlerts} from '../core/ops-alerts';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data),value=fn(next);validateData(next);this.data=next;return value;}}
const origin='https://batyeo.test';
const completed=()=>{const d=seedData('x');const engine=new RentalEngine();const r=engine.start(d,'cust-refund','station-paris','k-refund',1_000);engine.return(d,r.id,'station-paris',2_000);return {d,rentalId:r.id};};
async function session(repo:MemoryRepository,userId:string){const token=crypto.randomUUID()+crypto.randomUUID();repo.data.sessions.push({id:await sha256(token),userId,expiresAt:Date.now()+100_000,authVersion:0});return token;}

test('a refund is bounded by what was actually captured, cumulative, and leaves the partner commission frozen',()=>{
 const {d,rentalId}=completed();const engine=new RentalEngine();
 const payment=d.payments.find(p=>p.rentalId===rentalId)!,rental=d.rentals.find(r=>r.id===rentalId)!;
 const commissionBefore=rental.commissionCents;
 assert.throws(()=>engine.markRefunded(d,rentalId,payment.capturedCents+1),/invalide/);
 assert.throws(()=>engine.markRefunded(d,rentalId,0),/invalide/);
 engine.markRefunded(d,rentalId,100);
 engine.markRefunded(d,rentalId,50);
 assert.equal(payment.refundedCents,150);
 assert.throws(()=>engine.markRefunded(d,rentalId,payment.capturedCents-149),/invalide/,'the running total is what is bounded, not each refund');
 assert.equal(rental.commissionCents,commissionBefore,'the partner share stays frozen in the pricing snapshot');
 assert.equal(d.events.filter(e=>e.rentalId===rentalId&&e.type==='PAYMENT_REFUNDED').length,2);
 validateData(d);
});

test('only a captured payment can be refunded',()=>{
 const d=seedData('x');const engine=new RentalEngine();
 const active=d.rentals.find(r=>r.state==='ACTIVE')!;
 assert.throws(()=>engine.markRefunded(d,active.id,100),/encaissé/);
});

test('the refund route is reserved to BATYEO finance roles and calls Stripe before recording anything',async()=>{
 const {d,rentalId}=completed();
 const payment=d.payments.find(p=>p.rentalId===rentalId)!;payment.provider='stripe';payment.providerReference='pi_test_1';
 const repo=new MemoryRepository(d);
 const calls:{cents:number}[]=[];
 const stripeProvider={authorize:async()=>({id:'pi',status:'requires_capture',amount:0}),capture:async()=>({id:'pi',status:'succeeded',amount:0}),release:async()=>({id:'pi',status:'canceled',amount:0}),retrieve:async()=>({id:'pi',status:'requires_capture',amount:0}),refund:async(_i:string,cents:number)=>{calls.push({cents});return {id:'re_1',status:'succeeded',amount:cents};}};
 const previousProvider=process.env.PAYMENT_PROVIDER,previousKey=process.env.STRIPE_SECRET_KEY;
 process.env.PAYMENT_PROVIDER='stripe_test';process.env.STRIPE_SECRET_KEY='sk_test_refund';
 try{
 const api=(token:string,body:unknown)=>createApi(repo,{demo:true,allowLegacyCredentials:true},{stripeProvider}).POST(new Request(origin+'/api/core/rental/refund',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)}),{params:Promise.resolve({path:['rental','refund']})});
 assert.equal((await api(await session(repo,'operations'),{rentalId,cents:100,reason:'test'})).status,403,'OPERATIONS has no money capability');
 assert.equal((await api(await session(repo,'partner-demo'),{rentalId,cents:100,reason:'test'})).status,403,'a partner cannot refund a customer');
 assert.equal(calls.length,0,'nothing reached Stripe on a refused request');
 const ok=await api(await session(repo,'finance'),{rentalId,cents:100,reason:'batterie retrouvée'});
 assert.equal(ok.status,200);
 assert.deepEqual(calls,[{cents:100}]);
 assert.equal(repo.data.payments.find(p=>p.rentalId===rentalId)!.refundedCents,100);
 assert.ok(repo.data.audits.some(a=>a.action.includes('Remboursement')&&a.action.includes('batterie retrouvée')));
 }finally{if(previousProvider===undefined)delete process.env.PAYMENT_PROVIDER;else process.env.PAYMENT_PROVIDER=previousProvider;if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey;}
});

test('a failing Stripe refund records nothing locally',async()=>{
 const {d,rentalId}=completed();
 const payment=d.payments.find(p=>p.rentalId===rentalId)!;payment.provider='stripe';payment.providerReference='pi_test_2';
 const repo=new MemoryRepository(d);
 const coordinator=new StripeRentalCoordinator({authorize:async()=>({id:'pi',status:'x',amount:0}),capture:async()=>({id:'pi',status:'x',amount:0}),release:async()=>({id:'pi',status:'x',amount:0}),retrieve:async()=>({id:'pi',status:'x',amount:0}),refund:async()=>{throw new Error('Stripe down');}});
 await assert.rejects(coordinator.refund(repo,rentalId,100),/Stripe down/);
 assert.equal(repo.data.payments.find(p=>p.rentalId===rentalId)!.refundedCents??0,0);
});

test('a bank dispute and a dashboard refund are picked up from Stripe even though their payload carries no rentalId',()=>{
 const {d,rentalId}=completed();
 const payment=d.payments.find(p=>p.rentalId===rentalId)!;payment.provider='stripe';payment.providerReference='pi_test_3';
 assert.deepEqual(applyStripeWebhook(d,{id:'evt_0',type:'charge.dispute.created',data:{object:{id:'dp_unknown',payment_intent:'pi_nope'}}}),{ignored:true});
 assert.deepEqual(applyStripeWebhook(d,{id:'evt_1',type:'charge.dispute.created',data:{object:{id:'dp_1',payment_intent:'pi_test_3'}}}),{disputed:true});
 assert.ok(payment.disputedAt,'the dispute is recorded even with no metadata on the payload');
 assert.deepEqual(applyStripeWebhook(d,{id:'evt_1',type:'charge.dispute.created',data:{object:{id:'dp_1',payment_intent:'pi_test_3'}}}),{duplicate:true});
 const alert=evaluateAlerts(d).find(a=>a.kind==='PAYMENT_DISPUTED');
 assert.ok(alert&&alert.severity==='CRITICAL'&&alert.rentalId===rentalId,'a dispute must be impossible to miss');

 const partial=Math.floor(payment.capturedCents/2);
 const refundEvent={id:'evt_2',type:'charge.refunded',data:{object:{id:'ch_1',payment_intent:'pi_test_3',amount_refunded:partial}}};
 assert.deepEqual(applyStripeWebhook(d,refundEvent),{refunded:true});
 assert.equal(payment.refundedCents,partial,'a refund issued from the Stripe dashboard lands in BATYEO too');
 assert.deepEqual(applyStripeWebhook(d,refundEvent),{duplicate:true},'Stripe reports a running total, so a redelivery changes nothing');
 assert.deepEqual(applyStripeWebhook(d,{id:'evt_3',type:'charge.refunded',data:{object:{id:'ch_1',payment_intent:'pi_test_3',amount_refunded:payment.capturedCents*5}}}),{refunded:true});
 assert.equal(payment.refundedCents,payment.capturedCents,'never more than what was captured, whatever Stripe reports');
 validateData(d);
});

test('the contact email is optional, normalised, and never handed to a partner',async()=>{
 const d=seedData('x');const engine=new RentalEngine();
 const withEmail=engine.start(d,'c1','station-paris','k1',1_000,'  Client@Exemple.FR ');
 const without=engine.start(d,'c2','station-paris','k2',1_000);
 assert.equal(withEmail.contactEmail,'client@exemple.fr','stored the way login looks addresses up');
 assert.equal(without.contactEmail,null,'refusing to give one never blocks a rental');
 validateData(d);
 const {dashboard}=await import('../core/queries');
 const staffView=dashboard(d,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null}).rentals.find(r=>r.id===withEmail.id)!;
 assert.equal(staffView.contactEmail,'client@exemple.fr');
 const partnerView=dashboard(d,{id:'partner-demo',role:'PARTNER_ADMIN',partnerId:'partner-a'}).rentals.find(r=>r.id===withEmail.id)!;
 assert.equal(partnerView.contactEmail,undefined,'a venue owner never sees who rented');
});

test('where money is real, a rental never starts on a bare PaymentIntent: no card attached means no battery and no charge',async()=>{
 const {StripeRentalCoordinator}=await import('../core/stripe-coordinator');
 const build=(status:string)=>{
  const calls:string[]=[];
  const stripe={authorize:async()=>{calls.push('authorize');return {id:'pi_bare',status,amount:2000};},capture:async()=>{calls.push('capture');return {id:'pi_bare',status:'succeeded',amount:2000};},release:async()=>{calls.push('release');return {id:'pi_bare',status:'canceled',amount:0};},retrieve:async()=>({id:'pi_bare',status,amount:2000}),refund:async()=>({id:'re',status:'ok',amount:0})};
  return {calls,stripe};
 };
 // Live: an intent that is not `requires_capture` holds nothing, so the rental must be refused and the intent cancelled.
 const bare=build('requires_payment_method');const repo=new MemoryRepository(seedData('x'));
 const live=new StripeRentalCoordinator(bare.stripe,undefined,undefined,{requireConfirmedAuthorization:true});
 const refused=await live.start(repo,'c-live','station-paris','k-live-1');
 assert.equal(refused.state,'PAYMENT_FAILED');
 assert.equal(refused.batteryId,null,'no battery left the cabinet');
 assert.deepEqual(bare.calls,['authorize','release'],'the empty intent was cancelled, nothing captured');
 assert.match(refused.error??'',/n’a pas été confirmé/);
 // Live: a genuinely authorized intent goes through.
 const good=build('requires_capture');
 const ok=await new StripeRentalCoordinator(good.stripe,undefined,undefined,{requireConfirmedAuthorization:true}).start(new MemoryRepository(seedData('x')),'c-ok','station-paris','k-live-2');
 assert.equal(ok.state,'ACTIVE');
 // Test mode keeps its existing behaviour: it is a rehearsal, and says so on every screen.
 const rehearsal=build('requires_payment_method');
 const test=await new StripeRentalCoordinator(rehearsal.stripe).start(new MemoryRepository(seedData('x')),'c-test','station-paris','k-test');
 assert.equal(test.state,'ACTIVE');
});

test('an operator can close a rental the cabinet failed to detect: priced up to the real return time, deposit released, logged — and refused for a partner or a closed rental',async()=>{
 const repo=new MemoryRepository(seedData('x'));const engine=new RentalEngine();
 const t0=Date.now()-5*3_600_000;
 const rental=await repo.transaction(d=>engine.start(d,'cust-force','station-paris','k-force',t0));
 const post=(user:string,body:unknown)=>session(repo,user).then(token=>createApi(repo,{demo:false,allowLegacyCredentials:false},{}).POST(new Request(origin+'/api/core/rental/force-return',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)}),{params:Promise.resolve({path:['rental','force-return']})}));
 assert.equal((await post('partner-demo',{rentalId:rental.id,stationId:'station-paris',reason:'test'})).status,403,'a partner cannot close a rental');
 assert.equal((await post('finance',{rentalId:rental.id,stationId:'station-paris',reason:'test'})).status,403,'nor a finance role: this is an operations act');
 assert.equal((await post('operations',{rentalId:rental.id,stationId:'station-paris',reason:'test',returnedAt:t0-1})).status,400,'never before the rental began');
 assert.equal((await post('operations',{rentalId:rental.id,stationId:'station-paris',reason:'test',returnedAt:Date.now()+3_600_000})).status,400,'never in the future');
 assert.equal((await post('operations',{rentalId:rental.id,stationId:'nowhere',reason:'test'})).status,404);
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'ACTIVE','refused calls changed nothing');

 // Handed back one hour after the start; the operator only notices five hours in — the customer pays for one hour, not five.
 const res=await post('operations',{rentalId:rental.id,stationId:'station-paris',reason:'batterie rendue au comptoir',returnedAt:t0+3_600_000});
 assert.equal(res.status,200);
 const closed=repo.data.rentals.find(r=>r.id===rental.id)!;
 assert.equal(closed.state,'COMPLETED');assert.equal(closed.returnedAt,t0+3_600_000);
 assert.equal(closed.amountCents,closed.pricing.hourlyCents,'one hour billed, not the five it took someone to notice');
 assert.ok(repo.data.events.some(e=>e.rentalId===rental.id&&e.detail.includes('Retour confirmé à la main')&&e.detail.includes('comptoir')));
 assert.ok(repo.data.audits.some(a=>a.action.includes('Retour clôturé à la main')));
 assert.equal(repo.data.batteries.find(b=>b.id===rental.batteryId)!.status,'AVAILABLE');
 validateData(repo.data);
 assert.equal((await post('operations',{rentalId:rental.id,stationId:'station-paris',reason:'again'})).status,409,'a closed rental cannot be closed again');
});

test('the public display route exposes only the safe kiosk-screen fields — idle content, banner, active playlist — never the Stripe Terminal location or unpublished/expired media',async()=>{
 const repo=new MemoryRepository(seedData('x'));
 repo.data.displayConfigs.push({id:'dc1',stationId:'station-paris',idleContent:'Rechargez pendant que vous profitez du bar !',supportContact:'contact@batyeo.fr',maintenanceBanner:'Travaux en cours',locale:'fr-FR',refreshIntervalMs:20000,featureFlags:{},translations:null,updatedAt:1});
 repo.data.stations.find(s=>s.id==='station-paris')!.stripeTerminalLocationId='tml_secret';
 repo.data.media.push(
  {id:'m1',name:'Live',kind:'IMAGE',uri:'https://cdn.test/live.png',checksum:'a',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:['station-paris'],createdAt:1,updatedAt:1},
  {id:'m2',name:'Draft',kind:'IMAGE',uri:'https://cdn.test/draft.png',checksum:'b',durationMs:5000,status:'DRAFT',startsAt:null,endsAt:null,targetStationIds:['station-paris'],createdAt:1,updatedAt:1},
  {id:'m3',name:'ForOther',kind:'IMAGE',uri:'https://cdn.test/other.png',checksum:'c',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:['station-lyon'],createdAt:1,updatedAt:1},
 );
 const res=await createApi(repo,{demo:false,allowLegacyCredentials:false},{}).GET(new Request(origin+'/api/core/display/paris-demo'),{params:Promise.resolve({path:['display','paris-demo']})});
 assert.equal(res.status,200);
 const body=await res.json() as {venueName:string;idleContent:string;maintenanceBanner:string|null;playlist:{id:string}[]};
 assert.equal(body.idleContent,'Rechargez pendant que vous profitez du bar !');
 assert.equal(body.maintenanceBanner,'Travaux en cours');
 assert.deepEqual(body.playlist.map(m=>m.id),['m1'],'only the published item targeted at this station');
 assert.ok(!JSON.stringify(body).includes('tml_secret'),'the Stripe Terminal location id is for the credentialed runtime app only, never a public page');
 assert.equal((await createApi(repo,{demo:false,allowLegacyCredentials:false},{}).GET(new Request(origin+'/api/core/display/unknown-station'),{params:Promise.resolve({path:['display','unknown-station']})})).status,404);
});
