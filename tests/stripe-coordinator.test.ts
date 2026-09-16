import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {RentalEngine} from '../core/rental';
import {validateData} from '../core/invariants';
import {MockBatteryStationProvider} from '../core/providers';
import {StripePaymentProvider,type StripeRequest} from '../core/stripe';
import {StripeRentalCoordinator,applyStripeWebhook} from '../core/stripe-coordinator';
import {evaluateAlerts} from '../core/ops-alerts';
import type {Data} from '../core/types';
import type {Repository} from '../core/repository';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data);const value=fn(next);validateData(next);this.data=next;return value;}
}
function provider(opts:{authorizeFail?:boolean;captureFail?:boolean}={}){
 const calls:StripeRequest[]=[];const stripe=new StripePaymentProvider('sk_test_coordinator',async request=>{calls.push(request);if(opts.authorizeFail&&request.path==='/payment_intents')throw new Error('authorization declined');if(opts.captureFail&&request.path.includes('/capture'))throw new Error('capture timeout');return {id:'pi_'+(request.path.includes('/capture')?'capture':'auth'),status:'requires_capture',amount:Number(request.body.amount??2000),amount_received:0};});return {stripe,calls};
}
test('Stripe coordinator performs authorization, ejection, exact capture and idempotent return',async()=>{const repo=new MemoryRepository(seedData('unused'));const {stripe,calls}=provider();const coordinator=new StripeRentalCoordinator(stripe);const started=await coordinator.start(repo,'stripe-customer','station-paris','stripe-key',1_800_000_000_000);assert.equal(started.state,'ACTIVE');assert.equal(started.paymentState,'AUTHORIZED');const finished=await coordinator.return(repo,started.id,'station-lyon',1_800_000_000_000+61*60_000);assert.equal(finished.state,'COMPLETED');assert.equal(finished.amountCents,400);assert.equal(repo.data.payments.find(p=>p.rentalId===started.id)?.capturedCents,400);assert.equal(calls.filter(c=>c.path.includes('/capture')).length,1);const again=await coordinator.return(repo,started.id,'station-lyon',1_800_000_000_000+61*60_000);assert.equal(again.id,started.id);assert.equal(repo.data.events.filter(e=>e.rentalId===started.id&&e.type==='PAYMENT_CAPTURED').length,1);});
test('Concurrent start() calls (double-submit / client retry) never release the deposit of an already active rental',async()=>{
 const repo=new MemoryRepository(seedData('unused'));const {stripe,calls}=provider();const coordinator=new StripeRentalCoordinator(stripe);
 const [a,b]=await Promise.all([
  coordinator.start(repo,'double-submit','station-paris','key-a',1_800_000_000_000),
  coordinator.start(repo,'double-submit','station-paris','key-b',1_800_000_000_000),
 ]);
 assert.equal(a.id,b.id);
 const rental=repo.data.rentals.find(r=>r.id===a.id)!;
 assert.equal(rental.state,'ACTIVE');
 assert.equal(rental.physicalState,'EJECTED');
 const payment=repo.data.payments.find(p=>p.rentalId===rental.id)!;
 assert.equal(payment.status,'AUTHORIZED');
 assert.equal(calls.filter(c=>c.path.includes('/cancel')).length,0);
});
test('Stripe coordinator releases authorization after ejection failure',async()=>{const repo=new MemoryRepository(seedData('unused'));const station=new MockBatteryStationProvider();station.simulateFailure(repo.data,'station-paris','ejection');const {stripe,calls}=provider();const coordinator=new StripeRentalCoordinator(stripe,station);const rental=await coordinator.start(repo,'stripe-failure','station-paris','stripe-fail',1_800_000_000_000);assert.equal(rental.state,'EJECTION_FAILED');assert.equal(rental.paymentState,'RELEASED');assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');assert.equal(calls.some(c=>c.path.includes('/cancel')) ,true);});
test('Stripe authorization failure is terminal and does not eject',async()=>{const repo=new MemoryRepository(seedData('unused'));const {stripe}=provider({authorizeFail:true});const coordinator=new StripeRentalCoordinator(stripe);const rental=await coordinator.start(repo,'stripe-auth-fail','station-paris','stripe-auth-fail',1_800_000_000_000);assert.equal(rental.state,'PAYMENT_FAILED');assert.equal(rental.paymentState,'FAILED');assert.equal(rental.batteryId,null);});
test('Stripe capture failure leaves an explicit unknown/error state for reconciliation',async()=>{const repo=new MemoryRepository(seedData('unused'));const {stripe}=provider({captureFail:true});const coordinator=new StripeRentalCoordinator(stripe);const started=await coordinator.start(repo,'stripe-capture-fail','station-paris','stripe-capture-fail',1_800_000_000_000);const failed=await coordinator.return(repo,started.id,'station-lyon',1_800_000_000_000+61*60_000);assert.equal(failed.state,'ERROR');assert.equal(failed.paymentState,'UNKNOWN');assert.equal(repo.data.payments.find(p=>p.rentalId===started.id)?.status,'UNKNOWN');});
test('Stripe capture retry after a transient timeout reuses the same rental',async()=>{const repo=new MemoryRepository(seedData('unused'));let captures=0;const stripe=new StripePaymentProvider('sk_test_retry',async request=>{if(request.path.includes('/capture')&&captures++===0)throw new Error('timeout');return {id:'pi_retry',status:'requires_capture',amount:2000};});const coordinator=new StripeRentalCoordinator(stripe);const started=await coordinator.start(repo,'stripe-retry','station-paris','stripe-retry',1_800_000_000_000);const failed=await coordinator.return(repo,started.id,'station-lyon',1_800_000_000_000+61*60_000);assert.equal(failed.state,'ERROR');const completed=await coordinator.return(repo,started.id,'station-lyon',1_800_000_000_000+61*60_000);assert.equal(completed.state,'COMPLETED');assert.equal(completed.amountCents,400);});
test('A failed overdue-loss capture surfaces as ERROR instead of staying silently OVERDUE',async()=>{
 const repo=new MemoryRepository(seedData('unused'));const {stripe}=provider({captureFail:true});const coordinator=new StripeRentalCoordinator(stripe);
 const started=await coordinator.start(repo,'stripe-lost-fail','station-paris','stripe-lost-fail',1_800_000_000_000);assert.equal(started.state,'ACTIVE');
 await repo.transaction(d=>new RentalEngine().refreshOverdue(d,1_800_000_000_000+49*3600000));
 const failed=await coordinator.captureOverdueLoss(repo,started.id,1_800_000_000_000+96*3600000);
 assert.equal(failed.state,'ERROR');
 assert.equal(repo.data.payments.find(p=>p.rentalId===started.id)?.status,'UNKNOWN');
 const alert=evaluateAlerts(repo.data,1_800_000_000_000+96*3600000).find(a=>a.id===`payment-mismatch-${started.id}`);
 assert.equal(alert?.severity,'CRITICAL');
});
test('Stripe coordinator captures the full deposit as a definitive loss when the battery is never returned',async()=>{
 const repo=new MemoryRepository(seedData('unused'));const {stripe,calls}=provider();const coordinator=new StripeRentalCoordinator(stripe);
 const started=await coordinator.start(repo,'stripe-lost','station-paris','stripe-lost',1_800_000_000_000);assert.equal(started.state,'ACTIVE');
 await repo.transaction(d=>new RentalEngine().refreshOverdue(d,1_800_000_000_000+49*3600000));
 assert.equal((await repo.read()).rentals.find(r=>r.id===started.id)?.state,'OVERDUE');
 const lost=await coordinator.captureOverdueLoss(repo,started.id,1_800_000_000_000+96*3600000);
 assert.equal(lost.state,'LOST');
 assert.equal(repo.data.payments.find(p=>p.rentalId===started.id)?.capturedCents,2000);
 assert.equal(repo.data.batteries.find(b=>b.id===lost.batteryId)?.status,'LOST');
 assert.equal(calls.filter(c=>c.path.includes('/capture')).length,1);
 const again=await coordinator.captureOverdueLoss(repo,started.id,1_800_000_000_000+96*3600000);
 assert.equal(again.state,'LOST');
 assert.equal(calls.filter(c=>c.path.includes('/capture')).length,1);
});
test('Stripe coordinator refuses captureOverdueLoss for a rental that moved past OVERDUE in the meantime (race with a normal return)',async()=>{
 const repo=new MemoryRepository(seedData('unused'));const {stripe,calls}=provider();const coordinator=new StripeRentalCoordinator(stripe);
 const started=await coordinator.start(repo,'stripe-raced','station-paris','stripe-raced',1_800_000_000_000);
 await repo.transaction(d=>new RentalEngine().refreshOverdue(d,1_800_000_000_000+49*3600000));
 await repo.transaction(d=>{d.rentals.find(r=>r.id===started.id)!.state='RETURN_PENDING';});
 await assert.rejects(()=>coordinator.captureOverdueLoss(repo,started.id,1_800_000_000_000+96*3600000),/restituée entre-temps/);
 assert.equal(calls.filter(c=>c.path.includes('/capture')).length,0);
});
test('Stripe canceling or failing an authorization mid-rental surfaces as an ERROR, not a silent released deposit',()=>{
 const active=seedData('unused'),rentalA=active.rentals.find(r=>r.state==='ACTIVE')!,paymentA=active.payments.find(p=>p.rentalId===rentalA.id)!;
 paymentA.provider='stripe';paymentA.providerReference='pi_cancel_test';
 const resultA=applyStripeWebhook(active,{id:'evt-cancel-mid-rental',type:'payment_intent.canceled',data:{object:{id:'pi_cancel_test',metadata:{rentalId:rentalA.id}}}});
 assert.equal(resultA.ignored,false);
 assert.equal(rentalA.state,'ERROR');
 assert.ok(rentalA.error?.length);
 assert.equal(paymentA.status,'RELEASED');
 assert.doesNotThrow(()=>validateData(active));
 const overdue=seedData('unused'),rentalB=overdue.rentals.find(r=>r.state==='ACTIVE')!,paymentB=overdue.payments.find(p=>p.rentalId===rentalB.id)!;
 rentalB.state='OVERDUE';paymentB.provider='stripe';paymentB.providerReference='pi_fail_test';
 applyStripeWebhook(overdue,{id:'evt-fail-mid-rental',type:'payment_intent.payment_failed',data:{object:{id:'pi_fail_test',metadata:{rentalId:rentalB.id}}}});
 assert.equal(rentalB.state,'ERROR');
 assert.equal(paymentB.status,'FAILED');
});
test('An ERROR rental raises a CRITICAL PAYMENT_MISMATCH alert',()=>{
 const d=seedData('unused'),rental=d.rentals.find(r=>r.state==='ACTIVE')!,payment=d.payments.find(p=>p.rentalId===rental.id)!;
 payment.provider='stripe';payment.providerReference='pi_alert_test';
 applyStripeWebhook(d,{id:'evt-alert',type:'payment_intent.canceled',data:{object:{id:'pi_alert_test',metadata:{rentalId:rental.id}}}});
 const alert=evaluateAlerts(d).find(a=>a.id===`payment-mismatch-${rental.id}`);
 assert.equal(alert?.kind,'PAYMENT_MISMATCH');
 assert.equal(alert?.severity,'CRITICAL');
});
test('Stripe webhook projection is idempotent, monotonic and rejects incoherent amounts',()=>{const d=seedData('unused');const rental=d.rentals.find(r=>r.state==='ACTIVE')!;const payment=d.payments.find(p=>p.rentalId===rental.id)!;payment.provider='stripe';payment.providerReference='pi_webhook';applyStripeWebhook(d,{id:'evt-auth',type:'payment_intent.amount_capturable_updated',data:{object:{id:'pi_webhook',metadata:{rentalId:rental.id},amount:2000}}});assert.equal(payment.status,'AUTHORIZED');applyStripeWebhook(d,{id:'evt-capture',type:'payment_intent.succeeded',data:{object:{id:'pi_webhook',metadata:{rentalId:rental.id},amount_received:400}}});assert.equal(payment.status,'CAPTURED');applyStripeWebhook(d,{id:'evt-cancel',type:'payment_intent.canceled',data:{object:{id:'pi_webhook',metadata:{rentalId:rental.id}}}});assert.equal(payment.status,'CAPTURED');payment.status='AUTHORIZED';payment.authorizedCents=2000;payment.capturedCents=0;payment.releasedCents=0;const mismatch=applyStripeWebhook(d,{id:'evt-bad',type:'payment_intent.succeeded',data:{object:{id:'pi_webhook',metadata:{rentalId:rental.id},amount_received:99999}}});assert.equal(mismatch.mismatch,true);assert.equal(payment.status,'UNKNOWN');});
