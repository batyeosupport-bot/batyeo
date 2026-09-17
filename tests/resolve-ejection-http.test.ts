import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {RentalEngine} from '../core/rental';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import {StripePaymentProvider,type StripeRequest} from '../core/stripe';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

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
/** Builds a rental already stuck in the exact PHYSICAL_UNKNOWN incident this route exists to resolve. */
function uncertainRental(repo:MemoryRepository,provider:'mock'|'stripe'='mock'){
 const engine=new RentalEngine();
 const rental=engine.create(repo.data,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(repo.data,rental.id,rental.pricing.depositCents,provider,provider==='stripe'?'pi_test_auth':undefined);
 engine.beginEjection(repo.data,rental.id);
 engine.markEjectionUncertain(repo.data,rental.id,'Le fabricant n’a pas confirmé l’éjection.',Date.now());
 return rental;
}
function stripeEnv(){
 const previousProvider=process.env.PAYMENT_PROVIDER,previousKey=process.env.STRIPE_SECRET_KEY;
 process.env.PAYMENT_PROVIDER='stripe_test';process.env.STRIPE_SECRET_KEY='sk_test_resolve';
 return ()=>{if(previousProvider===undefined)delete process.env.PAYMENT_PROVIDER;else process.env.PAYMENT_PROVIDER=previousProvider;if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey;};
}
function fakeStripe(){const calls:StripeRequest[]=[];const stripeProvider=new StripePaymentProvider('sk_test_resolve',async request=>{calls.push(request);return {id:'pi_release',status:'canceled',amount:0,amount_received:0};});return {stripeProvider,calls};}

test('rental/resolve-ejection (mock mode): EJECTED activates the rental and removes the battery from its slot',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const rental=uncertainRental(repo);
 const token=await tokenFor(repo);
 const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id;
 const response=await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'EJECTED',batteryId},token);
 assert.equal(response.status,200);
 const body=await response.json() as {rental:{state:string;batteryId:string}};
 assert.equal(body.rental.state,'ACTIVE');
 assert.equal(body.rental.batteryId,batteryId);
 assert.equal(repo.data.batteries.find(b=>b.id===batteryId)?.status,'RENTED');
});

test('rental/resolve-ejection (mock mode): NOT_EJECTED fails the rental and releases the deposit',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const rental=uncertainRental(repo);
 const token=await tokenFor(repo);
 const response=await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'NOT_EJECTED'},token);
 assert.equal(response.status,200);
 const body=await response.json() as {rental:{state:string}};
 assert.equal(body.rental.state,'EJECTION_FAILED');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');
});

test('rental/resolve-ejection requires a batteryId for EJECTED and rejects one that is not really available there',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const rental=uncertainRental(repo);
 const token=await tokenFor(repo);
 assert.equal((await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'EJECTED'},token)).status,400);
 assert.equal((await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'EJECTED',batteryId:'not-a-real-battery'},token)).status,409);
});

test('rental/resolve-ejection refuses a rental that was never marked uncertain',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const token=await tokenFor(repo);
 const plain=repo.data.rentals[0];
 assert.equal((await call(repo,'rental/resolve-ejection',{rentalId:plain.id,outcome:'NOT_EJECTED'},token)).status,409);
});
test('rental/resolve-ejection returns 404 for an unknown rental id',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const token=await tokenFor(repo);
 assert.equal((await call(repo,'rental/resolve-ejection',{rentalId:'not-a-real-rental',outcome:'NOT_EJECTED'},token)).status,404);
});

test('rental/resolve-ejection is refused for a non-operator role',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const rental=uncertainRental(repo);
 const token=await tokenFor(repo,'SUPPORT');
 assert.equal((await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'NOT_EJECTED'},token)).status,403);
});

test('rental/resolve-ejection (Stripe mode): NOT_EJECTED actually calls Stripe to release the authorization',async()=>{
 const restore=stripeEnv();
 try {
  const repo=new MemoryRepository(seedData('unused'));
  const rental=uncertainRental(repo,'stripe');
  const token=await tokenFor(repo);
  const {stripeProvider,calls}=fakeStripe();
  const response=await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'NOT_EJECTED'},token,{stripeProvider});
  assert.equal(response.status,200);
  const body=await response.json() as {rental:{state:string}};
  assert.equal(body.rental.state,'EJECTION_FAILED');
  assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');
  assert.ok(calls.some(c=>c.path.includes('/cancel')));
 } finally {restore();}
});

test('rental/resolve-ejection (Stripe mode): EJECTED makes no Stripe call at all',async()=>{
 const restore=stripeEnv();
 try {
  const repo=new MemoryRepository(seedData('unused'));
  const rental=uncertainRental(repo,'stripe');
  const token=await tokenFor(repo);
  const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id;
  const {stripeProvider,calls}=fakeStripe();
  const response=await call(repo,'rental/resolve-ejection',{rentalId:rental.id,outcome:'EJECTED',batteryId},token,{stripeProvider});
  assert.equal(response.status,200);
  assert.equal(calls.length,0);
  assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'AUTHORIZED');
 } finally {restore();}
});
