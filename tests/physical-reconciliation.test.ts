import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {RentalEngine} from '../core/rental';
import {validateData} from '../core/invariants';
import {DomainError,MockBatteryStationProvider,MockPaymentProvider,PhysicalResultUnknownError,type BatteryStationProvider} from '../core/providers';
import {StripePaymentProvider,type StripeRequest} from '../core/stripe';
import {StripeRentalCoordinator} from '../core/stripe-coordinator';
import {evaluateAlerts} from '../core/ops-alerts';
import type {Data} from '../core/types';
import type {Repository} from '../core/repository';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data);const value=fn(next);validateData(next);this.data=next;return value;}
}
/** A station provider standing in for a real Route B manufacturer client: the command left, but the outcome never came back. */
class UncertainStationProvider extends MockBatteryStationProvider implements BatteryStationProvider {
 ejectBattery():string {throw new PhysicalResultUnknownError('La station Bajie n’a pas confirmé l’éjection avant expiration du délai.');}
}
function stripeProvider(){const calls:StripeRequest[]=[];const stripe=new StripePaymentProvider('sk_test_reconciliation',async request=>{calls.push(request);return {id:'pi_'+(request.path.includes('/capture')?'capture':'auth'),status:'requires_capture',amount:Number(request.body.amount??2000),amount_received:0};});return {stripe,calls};}

test('markEjectionUncertain leaves the rental EJECTING with the deposit still authorized, never released or captured',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);
 engine.beginEjection(d,rental.id);
 const result=engine.markEjectionUncertain(d,rental.id,'Timeout fabricant',100);
 assert.equal(result.state,'EJECTING');
 assert.equal(result.physicalState,'UNKNOWN');
 assert.equal(result.error,'Timeout fabricant');
 const payment=d.payments.find(p=>p.rentalId===rental.id);
 assert.equal(payment?.status,'AUTHORIZED');
 assert.doesNotThrow(()=>validateData(d));
});

test('markEjectionUncertain is idempotent and refuses a rental that is not mid-ejection',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 assert.throws(()=>engine.markEjectionUncertain(d,rental.id,'x',10),/n’est pas en cours d’éjection/);
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'first report',20);
 const again=engine.markEjectionUncertain(d,rental.id,'second report, ignored',30);
 assert.equal(again.error,'first report');
});

test('markEjectionUncertain never blind-retries: once reported, activateWithBattery or failEjection are the only ways forward',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'timeout',20);
 assert.throws(()=>engine.beginEjection(d,rental.id),DomainError);
 const activated=engine.activateWithBattery(d,rental.id,d.batteries.find(b=>b.status==='AVAILABLE')!.id,30);
 assert.equal(activated.state,'ACTIVE');
 assert.equal(activated.physicalState,'EJECTED');
});

test('a resolved-as-ejected reconciliation puts the rental back into normal, billed ACTIVE life',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'timeout',1_000);
 const batteryId=d.batteries.find(b=>b.status==='AVAILABLE')!.id;
 const activated=engine.activateWithBattery(d,rental.id,batteryId,2_000);
 assert.equal(activated.startedAt,2_000);
 assert.equal(activated.deadline,2_000+rental.pricing.deadlineHours*3_600_000);
 assert.equal(evaluateAlerts(d,3_000).some(a=>a.kind==='PHYSICAL_UNKNOWN'),false);
});

test('a resolved-as-not-ejected reconciliation fails the rental and releases the deposit',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'timeout',1_000);
 const failed=engine.failEjection(d,rental.id,'Confirmé par le fabricant : aucune batterie n’a quitté le slot.',2_000);
 assert.equal(failed.state,'EJECTION_FAILED');
 engine.markPaymentReleased(d,rental.id,2_100);
 const payment=d.payments.find(p=>p.rentalId===rental.id);
 assert.equal(payment?.status,'RELEASED');
 assert.doesNotThrow(()=>validateData(d));
 assert.equal(evaluateAlerts(d,3_000).some(a=>a.kind==='PHYSICAL_UNKNOWN'),false);
});

test('an uncertain physical result raises a CRITICAL PHYSICAL_UNKNOWN alert distinct from PAYMENT_MISMATCH',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'Le fabricant n’a pas confirmé l’éjection.',1_000);
 const alerts=evaluateAlerts(d,2_000);
 const alert=alerts.find(a=>a.kind==='PHYSICAL_UNKNOWN');
 assert.ok(alert);
 assert.equal(alert!.severity,'CRITICAL');
 assert.equal(alerts.some(a=>a.kind==='PAYMENT_MISMATCH'),false);
});

test('RentalEngine.start() with a provider that cannot confirm ejection stops the customer with an authorized-but-uncertain rental, not a silent charge',()=>{
 const d=seedData('hash');
 const engine=new RentalEngine(new MockPaymentProvider(),new UncertainStationProvider());
 const rental=engine.start(d,'cust','station-paris','key-1');
 assert.equal(rental.state,'EJECTING');
 assert.equal(rental.physicalState,'UNKNOWN');
 assert.equal(d.payments.find(p=>p.rentalId===rental.id)?.status,'AUTHORIZED');
 // A retried start() (client double-submit / offline retry) must not send a second physical command.
 const retried=engine.start(d,'cust','station-paris','key-2');
 assert.equal(retried.id,rental.id);
 assert.equal(retried.physicalState,'UNKNOWN');
});

test('StripeRentalCoordinator.start() routes an unconfirmed ejection to reconciliation instead of releasing the authorization on a guess',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const {stripe}=stripeProvider();
 const coordinator=new StripeRentalCoordinator(stripe,new UncertainStationProvider());
 const rental=await coordinator.start(repo,'stripe-uncertain','station-paris','idem-1',1_800_000_000_000);
 assert.equal(rental.state,'EJECTING');
 assert.equal(rental.physicalState,'UNKNOWN');
 const payment=repo.data.payments.find(p=>p.rentalId===rental.id);
 assert.equal(payment?.status,'AUTHORIZED');
 assert.ok(evaluateAlerts(repo.data,1_800_000_001_000).some(a=>a.kind==='PHYSICAL_UNKNOWN'&&a.severity==='CRITICAL'));
});

function uncertain(now=1_000){
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(d,rental.id,rental.pricing.depositCents);engine.beginEjection(d,rental.id);
 engine.markEjectionUncertain(d,rental.id,'timeout',now);
 return {d,engine,rental};
}
test('resolveEjectionConfirmed refuses a rental that was never marked uncertain',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const rental=engine.create(d,'cust','station-paris','key-1');
 const batteryId=d.batteries.find(b=>b.status==='AVAILABLE')!.id;
 assert.throws(()=>engine.resolveEjectionConfirmed(d,rental.id,batteryId,2_000),/résultat physique incertain/);
});
test('resolveEjectionConfirmed rejects a battery that is not sitting available at the rental\'s own station',()=>{
 const {d,engine,rental}=uncertain();
 assert.throws(()=>engine.resolveEjectionConfirmed(d,rental.id,'not-a-real-battery',2_000),/n’est pas disponible/);
 const otherStationBattery=d.batteries.find(b=>b.status==='AVAILABLE'&&!d.slots.some(s=>s.stationId==='station-paris'&&s.batteryId===b.id));
 if(otherStationBattery)assert.throws(()=>engine.resolveEjectionConfirmed(d,rental.id,otherStationBattery.id,2_000),/n’est pas disponible/);
});
test('resolveEjectionConfirmed moves the battery out of its slot exactly as a normal ejection would, then activates the rental',()=>{
 const {d,engine,rental}=uncertain();
 const batteryId=d.batteries.find(b=>b.status==='AVAILABLE'&&d.slots.some(s=>s.stationId==='station-paris'&&s.batteryId===b.id))!.id;
 const activated=engine.resolveEjectionConfirmed(d,rental.id,batteryId,2_000);
 assert.equal(activated.state,'ACTIVE');
 assert.equal(activated.batteryId,batteryId);
 assert.equal(d.batteries.find(b=>b.id===batteryId)!.status,'RENTED');
 assert.equal(d.slots.some(s=>s.batteryId===batteryId),false);
 assert.doesNotThrow(()=>validateData(d));
});
test('resolveEjectionConfirmed is not reusable once the incident is already resolved',()=>{
 const {d,engine,rental}=uncertain();
 const batteryId=d.batteries.find(b=>b.status==='AVAILABLE')!.id;
 engine.resolveEjectionConfirmed(d,rental.id,batteryId,2_000);
 const another=d.batteries.find(b=>b.status==='AVAILABLE')!.id;
 assert.throws(()=>engine.resolveEjectionConfirmed(d,rental.id,another,3_000),/résultat physique incertain/);
});
test('resolveEjectionFailed refuses a rental that was never marked uncertain, and fails a genuinely uncertain one',()=>{
 const d=seedData('hash');const engine=new RentalEngine();
 const plain=engine.create(d,'cust','station-paris','key-1');
 assert.throws(()=>engine.resolveEjectionFailed(d,plain.id,2_000),/résultat physique incertain/);
 const {engine:engine2,rental,d:d2}=uncertain();
 const failed=engine2.resolveEjectionFailed(d2,rental.id,2_000);
 assert.equal(failed.state,'EJECTION_FAILED');
 engine2.markPaymentReleased(d2,rental.id,2_100);
 assert.equal(d2.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');
});

test('StripeRentalCoordinator.resolveEjectionConfirmed makes no Stripe call: the deposit was already authorized and untouched',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const engine=new RentalEngine();
 const rental=engine.create(repo.data,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(repo.data,rental.id,rental.pricing.depositCents,'stripe','pi_test_auth');
 engine.beginEjection(repo.data,rental.id);engine.markEjectionUncertain(repo.data,rental.id,'timeout',1_000);
 const {stripe,calls}=stripeProvider();
 const coordinator=new StripeRentalCoordinator(stripe);
 const batteryId=repo.data.batteries.find(b=>b.status==='AVAILABLE')!.id;
 const activated=await coordinator.resolveEjectionConfirmed(repo,rental.id,batteryId,2_000);
 assert.equal(activated.state,'ACTIVE');
 assert.equal(calls.length,0);
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'AUTHORIZED');
});
test('StripeRentalCoordinator.resolveEjectionFailed actually releases the Stripe authorization, not just the local record',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const engine=new RentalEngine();
 const rental=engine.create(repo.data,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(repo.data,rental.id,rental.pricing.depositCents,'stripe','pi_test_auth');
 engine.beginEjection(repo.data,rental.id);engine.markEjectionUncertain(repo.data,rental.id,'timeout',1_000);
 const {stripe,calls}=stripeProvider();
 const coordinator=new StripeRentalCoordinator(stripe);
 const failed=await coordinator.resolveEjectionFailed(repo,rental.id,2_000);
 assert.equal(failed.state,'EJECTION_FAILED');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'RELEASED');
 assert.ok(calls.some(c=>c.path.includes('/cancel')));
});
test('StripeRentalCoordinator.resolveEjectionFailed surfaces ERROR instead of a silent release when Stripe itself fails',async()=>{
 const repo=new MemoryRepository(seedData('unused'));
 const engine=new RentalEngine();
 const rental=engine.create(repo.data,'cust','station-paris','key-1');
 engine.markPaymentAuthorized(repo.data,rental.id,rental.pricing.depositCents,'stripe','pi_test_auth');
 engine.beginEjection(repo.data,rental.id);engine.markEjectionUncertain(repo.data,rental.id,'timeout',1_000);
 const stripe=new StripePaymentProvider('sk_test_fail',async()=>{throw new Error('network down');});
 const coordinator=new StripeRentalCoordinator(stripe);
 const result=await coordinator.resolveEjectionFailed(repo,rental.id,2_000);
 assert.equal(result.state,'ERROR');
 assert.equal(repo.data.payments.find(p=>p.rentalId===rental.id)?.status,'UNKNOWN');
});
