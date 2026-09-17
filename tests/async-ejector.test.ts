import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {DomainError,PhysicalResultUnknownError} from '../core/providers';
import {StripePaymentProvider,type StripeRequest} from '../core/stripe';
import {StripeRentalCoordinator,type AsyncBatteryEjector} from '../core/stripe-coordinator';
import type {Data} from '../core/types';
import type {Repository} from '../core/repository';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data);const value=fn(next);validateData(next);this.data=next;return value;}
}
function stripeProvider(){const calls:StripeRequest[]=[];const stripe=new StripePaymentProvider('sk_test_ejector',async request=>{calls.push(request);return {id:'pi_'+(request.path.includes('/capture')?'capture':'auth'),status:'requires_capture',amount:Number(request.body.amount??2000),amount_received:0};});return {stripe,calls};}
/** Stands in for a real Route B manufacturer client: no Data access, a pure async call that names which battery left (or fails, or times out). */
function ejectorReturning(batteryId:string|null,error?:Error):AsyncBatteryEjector{return {async ejectBatteryAsync(){if(error)throw error;return batteryId!;}};}

test('an async ejector never runs inside a repository transaction: the network call happens strictly between two commits',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 let calledWhileTransacting=false;
 const trackedRepo:Repository={
  read:()=>repo.read(),
  transaction:async fn=>{calledWhileTransacting=true;try{return await repo.transaction(fn);}finally{calledWhileTransacting=false;}},
 };
 const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id;
 const ejector:AsyncBatteryEjector={async ejectBatteryAsync(){assert.equal(calledWhileTransacting,false,'ejectBatteryAsync must never run while a transaction is open');return batteryId;}};
 const coordinator=new StripeRentalCoordinator(stripe,undefined,ejector);
 const rental=await coordinator.start(trackedRepo,'async-customer','station-paris','async-key',1_800_000_000_000);
 assert.equal(rental.state,'ACTIVE');
 assert.equal(rental.batteryId,batteryId);
});

test('a successful async ejection removes the battery from its slot exactly as the sync path does',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE'&&repo.data.slots.some(s=>s.stationId==='station-paris'&&s.batteryId===b.id))!.id;
 const coordinator=new StripeRentalCoordinator(stripe,undefined,ejectorReturning(batteryId));
 const rental=await coordinator.start(repo,'async-customer','station-paris','async-key',1_800_000_000_000);
 assert.equal(rental.state,'ACTIVE');
 assert.equal(repo.data.batteries.find(b=>b.id===batteryId)?.status,'RENTED');
 assert.equal(repo.data.slots.some(s=>s.batteryId===batteryId),false);
 assert.doesNotThrow(()=>validateData(repo.data));
});

test('an async ejector claiming an already-taken or unknown battery is rejected, not silently double-booked',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 const already=await new StripeRentalCoordinator(stripe,undefined,ejectorReturning(repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id)).start(repo,'first','station-paris','first-key',1_800_000_000_000);
 const coordinator=new StripeRentalCoordinator(stripe,undefined,ejectorReturning(already.batteryId));
 const result=await coordinator.start(repo,'second','station-paris','second-key',1_800_000_000_000);
 // The claimed battery is rejected as a confirmed failure (not left uncertain), so the second
 // customer's authorization is actually released rather than stranded.
 assert.equal(result.state,'EJECTION_FAILED');
 assert.equal(repo.data.payments.find(p=>p.rentalId===result.id)?.status,'RELEASED');
 assert.notEqual(result.id,already.id);
});

test('an async ejector that cannot confirm the outcome routes to reconciliation, not a release',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 const coordinator=new StripeRentalCoordinator(stripe,undefined,ejectorReturning(null,new PhysicalResultUnknownError('Timeout fabricant.')));
 const rental=await coordinator.start(repo,'uncertain-customer','station-paris','uncertain-key',1_800_000_000_000);
 assert.equal(rental.state,'EJECTING');
 assert.equal(rental.physicalState,'UNKNOWN');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'AUTHORIZED');
});

test('an async ejector that confirms failure releases the deposit',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe,calls}=stripeProvider();
 const coordinator=new StripeRentalCoordinator(stripe,undefined,ejectorReturning(null,new DomainError('La batterie n’a pas pu être libérée.')));
 const rental=await coordinator.start(repo,'failed-customer','station-paris','failed-key',1_800_000_000_000);
 assert.equal(rental.state,'EJECTION_FAILED');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');
 assert.ok(calls.some(c=>c.path.includes('/cancel')));
});

test('a concurrent start() racing an in-flight async ejection backs off instead of ejecting a second battery or calling beginEjection twice',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 let releaseEject!:(batteryId:string)=>void;
 const gate=new Promise<string>(resolve=>{releaseEject=resolve;});
 const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id;
 const slowEjector:AsyncBatteryEjector={ejectBatteryAsync:()=>gate};
 const coordinator=new StripeRentalCoordinator(stripe,undefined,slowEjector);
 // Same double-submit shape as the mock-path concurrency test: same customer, different
 // idempotency keys, both fired before either settles. The first call's beginEjection commits,
 // then blocks on the (never-yet-resolved) ejector; the second must see EJECTING and back off
 // rather than call beginEjection again — which would throw — or eject a second battery.
 const firstPromise=coordinator.start(repo,'racer','station-paris','race-key-a',1_800_000_000_000);
 const secondPromise=coordinator.start(repo,'racer','station-paris','race-key-b',1_800_000_000_000);
 const second=await secondPromise;
 assert.equal(second.state,'EJECTING');
 releaseEject(batteryId);
 const first=await firstPromise;
 assert.equal(first.id,second.id);
 assert.equal(first.state,'ACTIVE');
 const finalRental=repo.data.rentals.find(r=>r.id===first.id)!;
 assert.equal(finalRental.state,'ACTIVE');
 assert.equal(repo.data.slots.filter(s=>s.batteryId===batteryId).length,0);
});
