import type {Repository} from './repository';
import {DomainError,MockBatteryStationProvider,PhysicalResultUnknownError,type BatteryStationProvider} from './providers';
import {RentalEngine} from './rental';
import {transition} from './state-machine';
import type {Data,Rental} from './types';
import type {StripeIntent,StripePaymentProvider} from './stripe';

/**
 * Route B seam: BatteryStationProvider.ejectBattery() is synchronous and mutates Data directly —
 * fine for the in-memory mock, but a real manufacturer client is a network call, which this
 * class's own rule forbids inside a repository transaction. A provider for real hardware
 * implements this instead: a pure async call with no Data access, returning the battery id (or
 * throwing DomainError for a confirmed failure, PhysicalResultUnknownError for an unconfirmed
 * one) exactly like StripePaymentProvider.authorize()/capture() already do for payment. The
 * coordinator applies the result to Data in a follow-up transaction. Not implemented by anything
 * yet — no manufacturer ejection endpoint is confirmed (docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md) —
 * this only defines the contract that implementation will have to satisfy.
 */
export interface AsyncBatteryEjector { ejectBatteryAsync(stationId:string):Promise<string>; }

/**
 * Coordinates external Stripe TEST calls around short, atomic domain commits.
 * No network call is made from a repository transaction, so optimistic/serializable
 * retries can never duplicate an authorization or capture. Stripe idempotency keys
 * make retries safe when the process loses the response.
 */
export class StripeRentalCoordinator {
 private readonly engine:RentalEngine;
 constructor(private readonly payment:Pick<StripePaymentProvider,'authorize'|'capture'|'release'|'refund'>,private readonly station:BatteryStationProvider=new MockBatteryStationProvider(),private readonly ejector?:AsyncBatteryEjector,private readonly options:{requireConfirmedAuthorization?:boolean}={}){this.engine=new RentalEngine(undefined,station);}

 async start(repository:Repository,customerId:string,stationId:string,key:string,now=Date.now(),contactEmail?:string):Promise<Rental>{
  const created=await repository.transaction(d=>this.engine.create(d,customerId,stationId,key,now,contactEmail));
  if(created.state!=='CREATED')return created;
  let intent:StripeIntent;
  try {intent=await this.payment.authorize(created.id,created.pricing.depositCents);}
  catch(error){const message=error instanceof Error?error.message:'Stripe authorization failed';await repository.transaction(d=>this.engine.markPaymentFailed(d,created.id,message,'stripe',now));return (await repository.read()).rentals.find(r=>r.id===created.id)!;}
  // Creating a PaymentIntent is not an authorization: with no card attached it sits in
  // `requires_payment_method` and holds nothing. Nothing in the customer flow attaches one yet, so
  // where money is real a rental must never start on the strength of a bare intent — that would hand
  // out a battery with no deposit behind it and fail only at capture, when the customer is gone.
  if(this.options.requireConfirmedAuthorization&&intent.status!=='requires_capture'){
   await this.payment.release(intent.id,created.id).catch(()=>undefined);
   await repository.transaction(d=>this.engine.markPaymentFailed(d,created.id,'Le paiement n’a pas été confirmé par la banque. Aucun montant n’est débité.','stripe',now));
   return (await repository.read()).rentals.find(r=>r.id===created.id)!;
  }
  await repository.transaction(d=>this.engine.markPaymentAuthorized(d,created.id,created.pricing.depositCents,'stripe',intent.id,now));
  if(!this.ejector){
   // Mock/demo station: ejectBattery() is synchronous and Data-mutating, so begin+eject+activate
   // stay a single atomic transaction exactly as before — no network call is actually made here.
   try {
    const active=await repository.transaction(d=>{
     const before=d.rentals.find(r=>r.id===created.id)!;
     if(before.state==='ACTIVE')return before;
     const r=this.engine.beginEjection(d,created.id,now);const battery=this.station.ejectBattery(d,stationId);d.events.push({id:crypto.randomUUID(),rentalId:r.id,at:now,type:'BATTERY_EJECTED',detail:`Batterie ${battery} libérée`});return this.engine.activateWithBattery(d,r.id,battery,now);
    });
    return active;
   } catch(error) {return this.handleEjectionError(repository,created.id,intent.id,error,now);}
  }
  // A real ejector makes a network call, so beginEjection commits on its own first. If another
  // concurrent start() (client double-submit) already claimed the ejection, this call backs off
  // instead of calling beginEjection again — which would throw — or ejecting a second battery.
  const claim=await repository.transaction(d=>{
   const before=d.rentals.find(r=>r.id===created.id)!;
   if(before.state!=='PAYMENT_AUTH')return false;
   this.engine.beginEjection(d,created.id,now);return true;
  });
  if(!claim)return (await repository.read()).rentals.find(r=>r.id===created.id)!;
  try {
   const battery=await this.ejector.ejectBatteryAsync(stationId);
   return await repository.transaction(d=>{
    const r=d.rentals.find(r=>r.id===created.id)!;
    // ejectBatteryAsync only names which battery left; it has no Data access to remove it from
    // its slot itself, so that bookkeeping — exactly what the sync ejectBattery() does as a side
    // effect — happens here, before activateWithBattery, so nothing else can claim it meanwhile.
    const slot=d.slots.find(s=>s.stationId===stationId&&s.batteryId===battery);
    const b=d.batteries.find(b=>b.id===battery);
    if(!slot||!b||b.status!=='AVAILABLE')throw new DomainError('Batterie confirmée par le fabricant introuvable ou déjà réservée.',409);
    slot.batteryId=null;b.status='RENTED';
    d.events.push({id:crypto.randomUUID(),rentalId:r.id,at:now,type:'BATTERY_EJECTED',detail:`Batterie ${battery} libérée`});
    return this.engine.activateWithBattery(d,r.id,battery,now);
   });
  } catch(error) {return this.handleEjectionError(repository,created.id,intent.id,error,now);}
 }

 /**
  * failEjection is only committed once the release has actually succeeded: it moves the rental
  * to the terminal EJECTION_FAILED state, which markPaymentUnknown below cannot recover from.
  * Failing the rental first and finding out the release itself failed would silently strand a
  * still-authorized deposit behind a rental that looks fully closed out.
  */
 private async handleEjectionError(repository:Repository,rentalId:string,intentId:string,error:unknown,now:number):Promise<Rental>{
  if(error instanceof PhysicalResultUnknownError){
   // The eject command was sent but its outcome is unconfirmed: never blind-retry, never release
   // the authorization on a guess. See docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md.
   return repository.transaction(d=>this.engine.markEjectionUncertain(d,rentalId,error.message,now));
  }
  const message=error instanceof Error?error.message:'Éjection impossible';
  try {
   await this.payment.release(intentId,rentalId);
   return repository.transaction(d=>{this.engine.failEjection(d,rentalId,message,now);this.engine.markPaymentReleased(d,rentalId,now);return d.rentals.find(r=>r.id===rentalId)!;});
  }
  catch(releaseError){const releaseMessage=releaseError instanceof Error?releaseError.message:'Stripe release failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,rentalId,releaseMessage,now));}
 }

 async return(repository:Repository,rentalId:string,stationId:string,now=Date.now(),detected=false):Promise<Rental>{
  const prepared=await repository.transaction(d=>this.engine.prepareReturn(d,rentalId,stationId,now,detected));
  if(prepared.state==='COMPLETED')return prepared;
  const snapshot=await repository.read();const payment=snapshot.payments.find(p=>p.rentalId===rentalId);if(!payment?.providerReference)throw new DomainError('Référence Stripe manquante.',503);
  if(payment.status==='CAPTURED')return repository.transaction(d=>this.engine.completeSettlement(d,rentalId,now));
  let intent:StripeIntent;
  try {intent=await this.payment.capture(payment.providerReference,prepared.amountCents,rentalId);}
  catch(error){const message=error instanceof Error?error.message:'Stripe capture failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,rentalId,message,now));}
  return repository.transaction(d=>this.engine.markPaymentCaptured(d,rentalId,prepared.amountCents,intent.id,now));
 }

 /** Refund path. Stripe is called outside any transaction, like every other money move here, and
  * the local record is written only once Stripe confirmed — a failed refund must never look done. */
 async refund(repository:Repository,rentalId:string,cents:number,now=Date.now()):Promise<Rental>{
  const snapshot=await repository.read();const payment=snapshot.payments.find(p=>p.rentalId===rentalId);
  if(!payment?.providerReference)throw new DomainError('Référence Stripe manquante.',503);
  if(payment.status!=='CAPTURED')throw new DomainError('Seul un paiement encaissé peut être remboursé.',409);
  const intent=await this.payment.refund(payment.providerReference,cents,rentalId);
  return repository.transaction(d=>this.engine.markRefunded(d,rentalId,cents,intent.id,now));
 }

 /** Perte définitive : capture Stripe intégrale de la caution pour une location OVERDUE depuis plus de 48 h. Idempotent. */
 async captureOverdueLoss(repository:Repository,rentalId:string,now=Date.now()):Promise<Rental>{
  const snapshot=await repository.read();const rental=snapshot.rentals.find(r=>r.id===rentalId);if(!rental)throw new DomainError('Location introuvable.',404);
  if(rental.state==='LOST')return rental;
  if(rental.state!=='OVERDUE')throw new DomainError('Cette location n’est plus en retard : elle a été restituée entre-temps.',409);
  const payment=snapshot.payments.find(p=>p.rentalId===rentalId);if(!payment?.providerReference)throw new DomainError('Référence Stripe manquante.',503);
  if(payment.status==='CAPTURED')return repository.transaction(d=>this.engine.markDepositLost(d,rentalId,payment.capturedCents,payment.providerReference??undefined,now));
  let intent:StripeIntent;
  try {intent=await this.payment.capture(payment.providerReference,rental.pricing.depositCents,rentalId);}
  catch(error){const message=error instanceof Error?error.message:'Stripe capture failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,rentalId,message,now));}
  return repository.transaction(d=>this.engine.markDepositLost(d,rentalId,rental.pricing.depositCents,intent.id,now));
 }

 /** Manual reconciliation of a PHYSICAL_UNKNOWN incident, confirmed ejected: purely local, no Stripe call needed — the authorization was never touched while uncertain, and stays exactly as it is now that the rental is active again. */
 async resolveEjectionConfirmed(repository:Repository,rentalId:string,batteryId:string,now=Date.now()):Promise<Rental>{
  return repository.transaction(d=>this.engine.resolveEjectionConfirmed(d,rentalId,batteryId,now));
 }

 /**
  * Manual reconciliation of a PHYSICAL_UNKNOWN incident, confirmed never ejected. The rental is
  * only failed (terminal EJECTION_FAILED) once the Stripe release has actually succeeded, and both
  * commit in the same transaction. Failing the rental first and finding out the release itself
  * failed would strand a still-authorized deposit behind a rental that looks fully closed out —
  * markPaymentUnknown can still reach ERROR from EJECTING, but never from EJECTION_FAILED.
  */
 async resolveEjectionFailed(repository:Repository,rentalId:string,now=Date.now()):Promise<Rental>{
  const snapshot=await repository.read();const rental=snapshot.rentals.find(r=>r.id===rentalId);if(!rental)throw new DomainError('Location introuvable.',404);
  if(rental.physicalState!=='UNKNOWN')throw new DomainError('Cette location n’a pas de résultat physique incertain à réconcilier.',409);
  const payment=snapshot.payments.find(p=>p.rentalId===rentalId);if(!payment?.providerReference)throw new DomainError('Référence Stripe manquante.',503);
  try {
   await this.payment.release(payment.providerReference,rentalId);
   return repository.transaction(d=>{this.engine.resolveEjectionFailed(d,rentalId,now);this.engine.markPaymentReleased(d,rentalId,now);return d.rentals.find(r=>r.id===rentalId)!;});
  }
  catch(releaseError){const releaseMessage=releaseError instanceof Error?releaseError.message:'Stripe release failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,rentalId,releaseMessage,now));}
 }

 /** Webhook-safe projection: never regresses a terminal payment or rental state. */
 async applyWebhook(repository:Repository,event:{id:string;type:string;data:{object:Record<string,unknown>}}){
  return repository.transaction(d=>applyStripeWebhook(d,event));
 }
}

export function applyStripeWebhook(d:Data,event:{id:string;type:string;data:{object:Record<string,unknown>}}){
 const object=event.data.object;
 // A Dispute or a refunded Charge carries its own object, whose metadata is not the intent's:
 // both are matched on the payment_intent they point at instead of on a rentalId that is absent.
 if(event.type.startsWith('charge.dispute.')||event.type==='charge.refunded'){
  const intent=typeof object.payment_intent==='string'?object.payment_intent:undefined;
  const disputedPayment=intent?d.payments.find(p=>p.providerReference===intent):undefined;
  const disputedRental=disputedPayment?d.rentals.find(r=>r.id===disputedPayment.rentalId):undefined;
  if(!disputedPayment||!disputedRental)return {ignored:true};
  if(event.type==='charge.refunded'){
   const refunded=Number(object.amount_refunded??0);
   if(!Number.isSafeInteger(refunded)||refunded<0)return {ignored:true};
   // Stripe reports the running total, so this stays right whether the refund came from BATYEO
   // or straight from the Stripe dashboard, and a redelivered event changes nothing.
   const total=Math.min(refunded,disputedPayment.capturedCents);
   if(total===(disputedPayment.refundedCents??0))return {duplicate:true};
   disputedPayment.refundedCents=total;
   d.events.push({id:crypto.randomUUID(),rentalId:disputedRental.id,at:Date.now(),type:'PAYMENT_REFUNDED',detail:`Remboursement confirmé par Stripe · ${total} centimes au total`});
   return {refunded:true};
  }
  if(disputedPayment.disputedAt)return {duplicate:true};
  disputedPayment.disputedAt=Date.now();
  d.events.push({id:crypto.randomUUID(),rentalId:disputedRental.id,at:Date.now(),type:'PAYMENT_DISPUTED',detail:'Contestation bancaire ouverte par la banque du client'});
  return {disputed:true};
 }
 const metadata=(object.metadata??{}) as Record<string,unknown>;const rentalId=typeof metadata.rentalId==='string'?metadata.rentalId:undefined;const intentId=typeof object.id==='string'?object.id:undefined;if(!rentalId||!intentId)return {ignored:true};
 const rental=d.rentals.find(r=>r.id===rentalId);const payment=d.payments.find(p=>p.rentalId===rentalId);if(!rental||!payment)return {ignored:true};
 payment.provider='stripe';payment.providerReference=intentId;
 if(event.type==='payment_intent.amount_capturable_updated'||event.type==='payment_intent.requires_capture'){if(payment.status==='PENDING'||payment.status==='AUTHORIZING'){payment.status='AUTHORIZED';payment.authorizedCents=Number(object.amount??payment.requestedCents??0);payment.requestedCents=payment.authorizedCents;rental.paymentState='AUTHORIZED';}}
 else if(event.type==='payment_intent.succeeded'||event.type==='charge.succeeded'){const captured=Number(object.amount_received??object.amount??0);if(['AUTHORIZED','CAPTURING','UNKNOWN'].includes(payment.status)){if(!Number.isSafeInteger(captured)||captured<0||captured>payment.authorizedCents){payment.status='UNKNOWN';payment.error='Stripe capture amount mismatch';rental.paymentState='UNKNOWN';return {ignored:false,rentalId,mismatch:true};}payment.status='CAPTURED';payment.capturedCents=captured;payment.releasedCents=payment.authorizedCents-captured;rental.paymentState='CAPTURED';if(rental.state==='RETURNED'&&captured===rental.amountCents){rental.state=transition(rental.state,'COMPLETED');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'COMPLETED',detail:'Capture Stripe confirmée · location terminée'});}}}
 else if(event.type==='payment_intent.canceled'){if(!['CAPTURED','RELEASED'].includes(payment.status)){payment.status='RELEASED';payment.releasedCents=payment.authorizedCents;payment.capturedCents=0;rental.paymentState='RELEASED';if(['ACTIVE','OVERDUE'].includes(rental.state)){rental.error='Autorisation Stripe annulée de façon inattendue pendant la location.';rental.state=transition(rental.state,'ERROR');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'ERROR',detail:rental.error});}}}
 else if(event.type==='payment_intent.payment_failed'){if(!['CAPTURED','RELEASED'].includes(payment.status)){payment.status='FAILED';payment.error='Stripe payment failed';rental.paymentState='FAILED';if(['ACTIVE','OVERDUE'].includes(rental.state)){rental.error='Échec de paiement Stripe inattendu pendant la location.';rental.state=transition(rental.state,'ERROR');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'ERROR',detail:rental.error});}}}
 return {ignored:false,rentalId,paymentStatus:payment.status};
}
