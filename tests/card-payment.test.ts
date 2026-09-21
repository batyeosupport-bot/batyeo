import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {sha256} from '../core/security';
import {StripeRentalCoordinator,STALE_UNCONFIRMED_MS} from '../core/stripe-coordinator';
import {StripePaymentProvider,type StripeIntent,type StripeRequest} from '../core/stripe';
import {createApi} from '../server/http';
import type {AsyncBatteryEjector} from '../core/stripe-coordinator';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data),v=fn(next);validateData(next);this.data=next;return v;}}

/** A Stripe stand-in that behaves the way the real one does: an intent is created empty, and only becomes `requires_capture` once the customer's card is confirmed. */
function fakeStripe(){
 const intents=new Map<string,StripeIntent&{cancelled?:boolean}>();const log:string[]=[];
 const provider={
  authorize:async(rentalId:string,cents:number)=>{log.push('authorize');const id=`pi_${rentalId.slice(0,8)}`;if(!intents.has(id))intents.set(id,{id,status:'requires_payment_method',amount:cents,client_secret:`${id}_secret`,metadata:{rentalId}});return intents.get(id)!;},
  retrieve:async(id:string)=>{log.push('retrieve');const i=intents.get(id);if(!i)throw new Error('no such intent');return {...i};},
  capture:async(id:string)=>({...intents.get(id)!,status:'succeeded'}),
  release:async(id:string)=>{log.push('release');const i=intents.get(id)!;i.status='canceled';return {...i};},
  refund:async()=>({id:'re',status:'ok',amount:0}),
 };
 const customerPays=(id:string)=>{const i=intents.get(id)!;i.status='requires_capture';i.amount_capturable=i.amount;};
 return {provider,intents,log,customerPays};
}
const seeded=()=>new MemoryRepository(seedData('x'));

test('begin creates the rental and the intent but authorizes nothing and moves no battery',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental,clientSecret}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 assert.equal(rental.state,'CREATED');assert.equal(rental.batteryId,null);
 assert.match(clientSecret??'',/_secret$/,'the browser gets what it needs to take the card');
 const payment=repo.data.payments.find(p=>p.rentalId===rental.id)!;
 assert.equal(payment.status,'PENDING');assert.equal(payment.authorizedCents,0,'a bare intent holds nothing, and BATYEO no longer pretends it does');
 assert.equal(payment.providerReference,stripe.intents.values().next().value!.id);
 assert.equal(repo.data.slots.filter(sl=>sl.stationId==='station-paris'&&sl.batteryId).length,seedData('x').slots.filter(sl=>sl.stationId==='station-paris'&&sl.batteryId).length,'every battery is still in its slot');
 validateData(repo.data);
});

test('a replay of begin — double tap, reload — finds the same rental and the same intent, and never a second charge',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const first=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 const second=await coordinator.begin(repo,'cust','station-paris','k-other-key',2_000);
 assert.equal(second.rental.id,first.rental.id);
 assert.equal(second.clientSecret,first.clientSecret);
 assert.equal(stripe.log.filter(l=>l==='authorize').length,1,'one intent for one rental');
 assert.equal(repo.data.payments.filter(p=>p.rentalId===first.rental.id).length,1);
});

test('confirm refuses while the card has not really been accepted, and releases the battery only once Stripe says the deposit is held',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 // The browser claims success, but Stripe still says the intent is empty: that claim is worth nothing.
 await assert.rejects(coordinator.confirm(repo,'cust',rental.id,2_000),(e:{status?:number;message:string})=>e.status===402&&/pas encore confirmé/.test(e.message));
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'CREATED');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.batteryId,null,'no battery left the cabinet');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)!.authorizedCents,0);

 stripe.customerPays([...stripe.intents.keys()][0]);
 const active=await coordinator.confirm(repo,'cust',rental.id,3_000);
 assert.equal(active.state,'ACTIVE');assert.ok(active.batteryId);
 const payment=repo.data.payments.find(p=>p.rentalId===rental.id)!;
 assert.equal(payment.status,'AUTHORIZED');assert.equal(payment.authorizedCents,active.pricing.depositCents);
 validateData(repo.data);
 // Idempotent: confirming again changes nothing and ejects nothing more.
 const rentedBefore=repo.data.batteries.filter(b=>b.status==='RENTED').length;
 const again=await coordinator.confirm(repo,'cust',rental.id,4_000);
 assert.equal(again.state,'ACTIVE');assert.equal(repo.data.batteries.filter(b=>b.status==='RENTED').length,rentedBefore,'no second battery');
});

test('confirm rejects a stranger, a foreign intent, a wrong amount and a cancelled intent',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 const id=[...stripe.intents.keys()][0];stripe.customerPays(id);
 await assert.rejects(coordinator.confirm(repo,'someone-else',rental.id),(e:{status?:number})=>e.status===404,'another customer cannot start your rental');
 stripe.intents.get(id)!.metadata={rentalId:'a-different-rental'};
 await assert.rejects(coordinator.confirm(repo,'cust',rental.id),(e:{status?:number})=>e.status===409,'an intent paid for something else is not this rental’s deposit');
 stripe.intents.get(id)!.metadata={rentalId:rental.id};stripe.intents.get(id)!.amount=100;stripe.intents.get(id)!.amount_capturable=100;
 await assert.rejects(coordinator.confirm(repo,'cust',rental.id),(e:{status?:number})=>e.status===409,'a token amount is not the deposit');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'CREATED');
 stripe.intents.get(id)!.amount=2000;stripe.intents.get(id)!.status='canceled';
 const failed=await coordinator.confirm(repo,'cust',rental.id);
 assert.equal(failed.state,'PAYMENT_FAILED');assert.equal(failed.batteryId,null);
});

test('a card rental never confirmed is expired after 15 minutes, its intent cancelled, and the customer is free again',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 assert.equal(await coordinator.expireStale(repo,1_000+STALE_UNCONFIRMED_MS-1),0,'not yet');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'CREATED');
 assert.equal(await coordinator.expireStale(repo,1_000+STALE_UNCONFIRMED_MS),1);
 const expired=repo.data.rentals.find(r=>r.id===rental.id)!;
 assert.equal(expired.state,'EXPIRED');
 assert.equal(stripe.intents.values().next().value!.status,'canceled','a card confirmed a moment too late cannot be charged for a rental that no longer exists');
 validateData(repo.data);
 // And the customer can start over — including somewhere else.
 const next=await coordinator.begin(repo,'cust','station-lyon','k2',1_000+STALE_UNCONFIRMED_MS+5);
 assert.equal(next.rental.state,'CREATED');assert.notEqual(next.rental.id,rental.id);
});

test('expiry never touches a rental that already holds a deposit or is in use',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 stripe.customerPays([...stripe.intents.keys()][0]);
 await coordinator.confirm(repo,'cust',rental.id,2_000);
 assert.equal(await coordinator.expireStale(repo,1_000+10*STALE_UNCONFIRMED_MS),0);
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'ACTIVE');
});

test('a real ejector is always given the station’s internal id — never the public QR id a customer types',async()=>{
 const stripe=fakeStripe(),repo=seeded();
 // Give the station a public id that differs from its internal id, like every station created from the admin.
 const target=repo.data.stations.find(s=>s.id==='station-paris')!;target.publicId='bar-du-coin';
 const asked:string[]=[];
 const ejector:AsyncBatteryEjector={ejectBatteryAsync:async(stationId)=>{asked.push(stationId);return repo.data.slots.find(s=>s.stationId===stationId&&s.batteryId)!.batteryId!;}};
 const coordinator=new StripeRentalCoordinator(stripe.provider,undefined,ejector);
 const {rental}=await coordinator.begin(repo,'cust','bar-du-coin','k1',1_000);
 stripe.customerPays([...stripe.intents.keys()][0]);
 const active=await coordinator.confirm(repo,'cust',rental.id,2_000);
 assert.deepEqual(asked,['station-paris'],'the ejector looks slots up by internal id: fed the public id it would fail after the battery had left');
 assert.equal(active.state,'ACTIVE');
});

const origin='https://batyeo.test';
async function customerCookie(repo:MemoryRepository){const token=crypto.randomUUID()+crypto.randomUUID();repo.data.customerSessions.push({id:await sha256(token),customerId:'walker',expiresAt:Date.now()+100_000});return token;}
function withStripeEnv<T>(env:Record<string,string>,run:()=>Promise<T>){
 const previous:Record<string,string|undefined>={};for(const k of Object.keys(env)){previous[k]=process.env[k];process.env[k]=env[k];}
 return run().finally(()=>{for(const k of Object.keys(env)){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
}
const api=(repo:MemoryRepository,provider:ReturnType<typeof fakeStripe>['provider'])=>createApi(repo,{demo:false,allowLegacyCredentials:false},{stripeProvider:provider});
const post=(a:ReturnType<typeof api>,path:string,body:unknown,token:string)=>a.POST(new Request(`${origin}/api/core/${path}`,{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_customer=${token}`},body:JSON.stringify(body)}),{params:Promise.resolve({path:path.split('/')})});

test('HTTP: start hands the browser its client secret, confirm-payment starts the rental only after Stripe agrees',async()=>{
 await withStripeEnv({PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_test_x',STRIPE_PUBLISHABLE_KEY:'pk_test_x'},async()=>{
  const stripe=fakeStripe(),repo=seeded(),token=await customerCookie(repo),a=api(repo,stripe.provider);
  const started=await post(a,'start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:crypto.randomUUID()},token);
  assert.equal(started.status,200);
  const body=await started.json() as {rental:{id:string;state:string};payment:{clientSecret:string;publishableKey:string}|null};
  assert.equal(body.rental.state,'CREATED');assert.equal(body.payment!.publishableKey,'pk_test_x');assert.match(body.payment!.clientSecret,/_secret$/);
  assert.ok(!JSON.stringify(body).includes('sk_test_x'),'the secret key never reaches the browser');

  const early=await post(a,'rental/confirm-payment',{rentalId:body.rental.id},token);
  assert.equal(early.status,402,'the browser saying "done" is not enough');
  assert.equal(repo.data.rentals.find(r=>r.id===body.rental.id)!.state,'CREATED');

  stripe.customerPays([...stripe.intents.keys()][0]);
  const done=await post(a,'rental/confirm-payment',{rentalId:body.rental.id},token);
  assert.equal(done.status,200);
  assert.equal((await done.json() as {rental:{state:string}}).rental.state,'ACTIVE');
  assert.equal((await post(a,'rental/confirm-payment',{rentalId:body.rental.id},'x'.repeat(40))).status,401,'no customer session, no confirmation');
 });
});

test('HTTP: card payments refuse to start when the publishable key is missing, and a key of the wrong environment stops the server',async()=>{
 await withStripeEnv({PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_test_x'},async()=>{
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const stripe=fakeStripe(),repo=seeded(),token=await customerCookie(repo);
  const res=await post(api(repo,stripe.provider),'start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:crypto.randomUUID()},token);
  assert.equal(res.status,503);assert.match((await res.json() as {error:string}).error,/STRIPE_PUBLISHABLE_KEY/);
  assert.equal(repo.data.rentals.filter(r=>r.customerId==='walker').length,0,'nothing was created without a way to take the card');
 });
 await withStripeEnv({PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_test_x',STRIPE_PUBLISHABLE_KEY:'pk_live_x'},async()=>{
  const res=await api(seeded(),fakeStripe().provider).GET(new Request(`${origin}/api/core/health`),{params:Promise.resolve({path:['health']})});
  assert.equal(res.status,503);assert.match((await res.json() as {error:string}).error,/pk_test_/);
 });
});

test('the Stripe provider reads an intent with a GET, creates card-only intents, and never sends a body or an idempotency key on a read',async()=>{
 const requests:StripeRequest[]=[];
 const provider=new StripePaymentProvider('sk_test_x',async r=>{requests.push(r);return {id:'pi_1',status:'requires_payment_method',amount:2000,client_secret:'s'};});
 await provider.authorize('rental-1',2000);await provider.retrieve('pi_1');
 assert.equal(requests[0].method,'POST');assert.deepEqual(requests[0].body.payment_method_types,['card']);assert.equal(requests[0].body.capture_method,'manual');
 assert.equal(requests[1].method,'GET');assert.equal(requests[1].path,'/payment_intents/pi_1');assert.deepEqual(requests[1].body,{});
});

test('a customer who changes their mind before paying frees themselves at once, and cannot cancel a rental that already holds a deposit',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 await assert.rejects(coordinator.abandon(repo,'stranger',rental.id),(e:{status?:number})=>e.status===404);
 const cancelled=await coordinator.abandon(repo,'cust',rental.id,2_000);
 assert.equal(cancelled.state,'CANCELLED');
 assert.equal(stripe.intents.values().next().value!.status,'canceled');
 validateData(repo.data);
 const next=await coordinator.begin(repo,'cust','station-lyon','k2',3_000);
 assert.equal(next.rental.state,'CREATED');
 stripe.customerPays([...stripe.intents.keys()][1]);
 const active=await coordinator.confirm(repo,'cust',next.rental.id,4_000);
 assert.equal((await coordinator.abandon(repo,'cust',active.id,5_000)).state,'ACTIVE','a rental in use is not cancellable');
});

test('a card accepted by Stripe but never confirmed by the customer — even after its webhook already marked it authorized — is released and expires instead of blocking them for ever',async()=>{
 const {applyStripeWebhook}=await import('../core/stripe-coordinator');
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 const intentId=[...stripe.intents.keys()][0];
 stripe.customerPays(intentId);
 await repo.transaction(d=>applyStripeWebhook(d,{id:'evt_auth',type:'payment_intent.amount_capturable_updated',data:{object:{id:intentId,amount:2000,metadata:{rentalId:rental.id}}}}));
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)!.status,'AUTHORIZED','the webhook got there first, as it often does');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'CREATED','but no battery has been released');
 assert.equal(await coordinator.expireStale(repo,1_000+STALE_UNCONFIRMED_MS),1);
 const expired=repo.data.rentals.find(r=>r.id===rental.id)!;
 assert.equal(expired.state,'EXPIRED');
 const payment=repo.data.payments.find(p=>p.rentalId===rental.id)!;
 assert.equal(payment.status,'RELEASED');assert.equal(payment.releasedCents,payment.authorizedCents,'the whole hold is given back');
 assert.equal(stripe.intents.get(intentId)!.status,'canceled');
 validateData(repo.data);
});

test('expiry survives a half-finished earlier attempt: an intent Stripe already cancelled counts as released',async()=>{
 const stripe=fakeStripe(),repo=seeded(),coordinator=new StripeRentalCoordinator(stripe.provider);
 const {rental}=await coordinator.begin(repo,'cust','station-paris','k1',1_000);
 const intentId=[...stripe.intents.keys()][0];
 stripe.intents.get(intentId)!.status='canceled';
 stripe.provider.release=async()=>{throw new Error('You cannot cancel this PaymentIntent because it has a status of canceled.');};
 assert.equal(await coordinator.expireStale(repo,1_000+STALE_UNCONFIRMED_MS),1,'no more rentals stuck behind an intent that is already gone');
 assert.equal(repo.data.rentals.find(r=>r.id===rental.id)!.state,'EXPIRED');
 // But when Stripe is genuinely unreachable, the rental is left alone rather than expired on a guess.
 const stripe2=fakeStripe(),repo2=seeded(),c2=new StripeRentalCoordinator(stripe2.provider);
 const second=await c2.begin(repo2,'cust','station-paris','k1',1_000);
 stripe2.provider.release=async()=>{throw new Error('network down');};stripe2.provider.retrieve=async()=>{throw new Error('network down');};
 assert.equal(await c2.expireStale(repo2,1_000+STALE_UNCONFIRMED_MS),0);
 assert.equal(repo2.data.rentals.find(r=>r.id===second.rental.id)!.state,'CREATED');
});
