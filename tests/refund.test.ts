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
 const stripeProvider={authorize:async()=>({id:'pi',status:'requires_capture',amount:0}),capture:async()=>({id:'pi',status:'succeeded',amount:0}),release:async()=>({id:'pi',status:'canceled',amount:0}),refund:async(_i:string,cents:number)=>{calls.push({cents});return {id:'re_1',status:'succeeded',amount:cents};}};
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
 const coordinator=new StripeRentalCoordinator({authorize:async()=>({id:'pi',status:'x',amount:0}),capture:async()=>({id:'pi',status:'x',amount:0}),release:async()=>({id:'pi',status:'x',amount:0}),refund:async()=>{throw new Error('Stripe down');}});
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
