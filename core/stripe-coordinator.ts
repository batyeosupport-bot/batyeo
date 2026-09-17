import type {Repository} from './repository';
import {DomainError,MockBatteryStationProvider,PhysicalResultUnknownError,type BatteryStationProvider} from './providers';
import {RentalEngine} from './rental';
import {transition} from './state-machine';
import type {Data,Rental} from './types';
import type {StripeIntent,StripePaymentProvider} from './stripe';

/**
 * Coordinates external Stripe TEST calls around short, atomic domain commits.
 * No network call is made from a repository transaction, so optimistic/serializable
 * retries can never duplicate an authorization or capture. Stripe idempotency keys
 * make retries safe when the process loses the response.
 */
export class StripeRentalCoordinator {
 private readonly engine:RentalEngine;
 constructor(private readonly payment:Pick<StripePaymentProvider,'authorize'|'capture'|'release'>,private readonly station:BatteryStationProvider=new MockBatteryStationProvider()){this.engine=new RentalEngine(undefined,station);}

 async start(repository:Repository,customerId:string,stationId:string,key:string,now=Date.now()):Promise<Rental>{
  const created=await repository.transaction(d=>this.engine.create(d,customerId,stationId,key,now));
  if(created.state!=='CREATED')return created;
  let intent:StripeIntent;
  try {intent=await this.payment.authorize(created.id,created.pricing.depositCents);}
  catch(error){const message=error instanceof Error?error.message:'Stripe authorization failed';await repository.transaction(d=>this.engine.markPaymentFailed(d,created.id,message,'stripe',now));return (await repository.read()).rentals.find(r=>r.id===created.id)!;}
  await repository.transaction(d=>this.engine.markPaymentAuthorized(d,created.id,created.pricing.depositCents,'stripe',intent.id,now));
  try {
   const active=await repository.transaction(d=>{
    const before=d.rentals.find(r=>r.id===created.id)!;
    if(before.state==='ACTIVE')return before;
    const r=this.engine.beginEjection(d,created.id,now);const battery=this.station.ejectBattery(d,stationId);d.events.push({id:crypto.randomUUID(),rentalId:r.id,at:now,type:'BATTERY_EJECTED',detail:`Batterie ${battery} libérée`});return this.engine.activateWithBattery(d,r.id,battery,now);
   });
   return active;
  } catch(error) {
   if(error instanceof PhysicalResultUnknownError){
    // The eject command was sent but its outcome is unconfirmed: never blind-retry, never release
    // the authorization on a guess. See docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md.
    return repository.transaction(d=>this.engine.markEjectionUncertain(d,created.id,error.message,now));
   }
   const message=error instanceof Error?error.message:'Éjection impossible';
   // failEjection is only committed once the release has actually succeeded: it moves the rental
   // to the terminal EJECTION_FAILED state, which markPaymentUnknown below cannot recover from.
   // Failing the rental first and finding out the release itself failed would silently strand a
   // still-authorized deposit behind a rental that looks fully closed out.
   try {
    await this.payment.release(intent.id,created.id);
    return repository.transaction(d=>{this.engine.failEjection(d,created.id,message,now);this.engine.markPaymentReleased(d,created.id,now);return d.rentals.find(r=>r.id===created.id)!;});
   }
   catch(releaseError){const releaseMessage=releaseError instanceof Error?releaseError.message:'Stripe release failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,created.id,releaseMessage,now));}
  }
 }

 async return(repository:Repository,rentalId:string,stationId:string,now=Date.now()):Promise<Rental>{
  const prepared=await repository.transaction(d=>this.engine.prepareReturn(d,rentalId,stationId,now));
  if(prepared.state==='COMPLETED')return prepared;
  const snapshot=await repository.read();const payment=snapshot.payments.find(p=>p.rentalId===rentalId);if(!payment?.providerReference)throw new DomainError('Référence Stripe manquante.',503);
  if(payment.status==='CAPTURED')return repository.transaction(d=>this.engine.completeSettlement(d,rentalId,now));
  let intent:StripeIntent;
  try {intent=await this.payment.capture(payment.providerReference,prepared.amountCents,rentalId);}
  catch(error){const message=error instanceof Error?error.message:'Stripe capture failed';return repository.transaction(d=>this.engine.markPaymentUnknown(d,rentalId,message,now));}
  return repository.transaction(d=>this.engine.markPaymentCaptured(d,rentalId,prepared.amountCents,intent.id,now));
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
 const object=event.data.object;const metadata=(object.metadata??{}) as Record<string,unknown>;const rentalId=typeof metadata.rentalId==='string'?metadata.rentalId:undefined;const intentId=typeof object.id==='string'?object.id:undefined;if(!rentalId||!intentId)return {ignored:true};
 const rental=d.rentals.find(r=>r.id===rentalId);const payment=d.payments.find(p=>p.rentalId===rentalId);if(!rental||!payment)return {ignored:true};
 payment.provider='stripe';payment.providerReference=intentId;
 if(event.type==='payment_intent.amount_capturable_updated'||event.type==='payment_intent.requires_capture'){if(payment.status==='PENDING'||payment.status==='AUTHORIZING'){payment.status='AUTHORIZED';payment.authorizedCents=Number(object.amount??payment.requestedCents??0);payment.requestedCents=payment.authorizedCents;rental.paymentState='AUTHORIZED';}}
 else if(event.type==='payment_intent.succeeded'||event.type==='charge.succeeded'){const captured=Number(object.amount_received??object.amount??0);if(['AUTHORIZED','CAPTURING','UNKNOWN'].includes(payment.status)){if(!Number.isSafeInteger(captured)||captured<0||captured>payment.authorizedCents){payment.status='UNKNOWN';payment.error='Stripe capture amount mismatch';rental.paymentState='UNKNOWN';return {ignored:false,rentalId,mismatch:true};}payment.status='CAPTURED';payment.capturedCents=captured;payment.releasedCents=payment.authorizedCents-captured;rental.paymentState='CAPTURED';if(rental.state==='RETURNED'&&captured===rental.amountCents){rental.state=transition(rental.state,'COMPLETED');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'COMPLETED',detail:'Capture Stripe confirmée · location terminée'});}}}
 else if(event.type==='payment_intent.canceled'){if(!['CAPTURED','RELEASED'].includes(payment.status)){payment.status='RELEASED';payment.releasedCents=payment.authorizedCents;payment.capturedCents=0;rental.paymentState='RELEASED';if(['ACTIVE','OVERDUE'].includes(rental.state)){rental.error='Autorisation Stripe annulée de façon inattendue pendant la location.';rental.state=transition(rental.state,'ERROR');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'ERROR',detail:rental.error});}}}
 else if(event.type==='payment_intent.payment_failed'){if(!['CAPTURED','RELEASED'].includes(payment.status)){payment.status='FAILED';payment.error='Stripe payment failed';rental.paymentState='FAILED';if(['ACTIVE','OVERDUE'].includes(rental.state)){rental.error='Échec de paiement Stripe inattendu pendant la location.';rental.state=transition(rental.state,'ERROR');d.events.push({id:crypto.randomUUID(),rentalId:rental.id,at:Date.now(),type:'ERROR',detail:rental.error});}}}
 return {ignored:false,rentalId,paymentStatus:payment.status};
}
