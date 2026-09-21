import {calculatePrice,commission,pricingForPartner} from './pricing';
import {TERMS_VERSION} from './terms';
import {transition, type RentalState} from './state-machine';
import {DomainError,MockBatteryStationProvider,MockPaymentProvider,PhysicalResultUnknownError, type BatteryStationProvider,type PaymentProvider} from './providers';
import type {Actor,Data,Payment,Rental} from './types';

export const OPEN_STATES:RentalState[]=['CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','OVERDUE','ERROR'];
/** Batterie jamais restituée : au-delà de ce délai après le retard, la caution est capturée en intégralité et la location est classée comme perte définitive. */
export const OVERDUE_LOSS_GRACE_MS=48*3_600_000;
export function overdueLossEligible(r:Rental,now=Date.now()):boolean {return r.state==='OVERDUE'&&r.deadline!==null&&now+r.simulatedMinutes*60_000-r.deadline>=OVERDUE_LOSS_GRACE_MS;}
export function authorize(actor:Actor|undefined,capability:'read'|'operate'|'finance'|'support'|'settings'|'pricing') {
 if(!actor)throw new DomainError('Veuillez vous connecter.',401);
 const permissions={read:['SUPER_ADMIN','ADMIN','OPERATIONS','FINANCE','SUPPORT','PARTNER_ADMIN','PARTNER_USER'],operate:['SUPER_ADMIN','ADMIN','OPERATIONS'],finance:['SUPER_ADMIN','ADMIN','FINANCE','PARTNER_ADMIN'],support:['SUPER_ADMIN','ADMIN','OPERATIONS','SUPPORT','PARTNER_ADMIN','PARTNER_USER'],settings:['SUPER_ADMIN','ADMIN','PARTNER_ADMIN'],pricing:['SUPER_ADMIN','ADMIN','FINANCE']};
 if(!permissions[capability].includes(actor.role))throw new DomainError('Accès non autorisé.',403);
}
export function inTenant(actor:Actor,partnerId:string|null):boolean {return !actor.role.startsWith('PARTNER_')|| (!!actor.partnerId&&actor.partnerId===partnerId);}
export function assertTenant(actor:Actor,partnerId:string|null){if(!inTenant(actor,partnerId))throw new DomainError('Ressource introuvable.',404);}

/** Synchronous demo engine. Lifecycle helpers are the seam used by the async Stripe coordinator. */
export class RentalEngine {
 constructor(private payment:PaymentProvider=new MockPaymentProvider(),private station:BatteryStationProvider=new MockBatteryStationProvider()){}
 private event(d:Data,r:Rental,type:string,detail:string,at:number){d.events.push({id:crypto.randomUUID(),rentalId:r.id,at,type,detail});}
 private move(d:Data,r:Rental,to:RentalState,detail:string,now:number){r.state=transition(r.state,to);this.event(d,r,to,detail,now);}
 private setPayment(r:Rental,state:Rental['paymentState']){if(state)r.paymentState=state;}
 private paymentFor(d:Data,r:Rental){return d.payments.find(p=>p.rentalId===r.id);}
 /** An optional contact address. The customer is otherwise nothing but a cookie: BATYEO could
  * capture a 20 € deposit for an unreturned battery without ever having had a way to warn the
  * person, and a cleared cookie locked them out of their own receipt. Never required — the rental
  * must stay possible for someone who refuses to give one. */
 create(d:Data,customerId:string,stationId:string,key:string,now=Date.now(),contactEmail?:string):Rental {
  const previous=d.rentals.find(r=>r.customerId===customerId&&r.idempotencyKey===key);if(previous){const requested=this.station.getStation(d,stationId);if(requested.id!==previous.stationId)throw new DomainError('Cette clé de demande correspond à une autre station.');return previous;}
  const open=d.rentals.find(r=>r.customerId===customerId&&OPEN_STATES.includes(r.state));if(open){const requested=this.station.getStation(d,stationId);if(requested.id!==open.stationId)throw new DomainError('Vous avez déjà une location en cours à une autre station.');return open;}
  const s=this.station.getStation(d,stationId);if(!s.online)throw new DomainError('Cette station est hors ligne. Choisissez une autre station.');if(s.rentalsBlocked)throw new DomainError('Cette station est temporairement bloquée pour maintenance.');if(this.station.getAvailability(d,s.id)<1)throw new DomainError('Toutes les batteries sont utilisées.');
  const grid=d.pricing[0];if(!grid)throw new DomainError('Tarification indisponible.',503);
  const pricing=structuredClone(pricingForPartner(grid,d.partners.find(p=>p.id===s.partnerId)?.commissionBps));
  const r:Rental={id:crypto.randomUUID(),customerId,partnerId:s.partnerId,stationId:s.id,batteryId:null,returnStationId:null,state:'CREATED',paymentState:'PENDING',physicalState:'IDLE',createdAt:now,startedAt:null,returnedAt:null,deadline:null,pricing,amountCents:0,commissionCents:0,idempotencyKey:key,contactEmail:contactEmail?.trim().toLowerCase()||null,error:null,simulatedMinutes:0};
  d.rentals.push(r);d.terms.push({id:crypto.randomUUID(),rentalId:r.id,version:TERMS_VERSION,acceptedAt:now,customerId});this.event(d,r,'CREATED','Location créée · conditions acceptées',now);return r;
 }
 private recordAuthorized(d:Data,r:Rental,cents:number,provider:'mock'|'stripe'='mock',reference?:string){const existing=this.paymentFor(d,r);if(existing){if(existing.status==='AUTHORIZED'&&existing.authorizedCents===cents)return existing;
  // The intent was attached before the customer confirmed their card (attachIntent): confirming is what turns it into a real authorization.
  if(['PENDING','AUTHORIZING'].includes(existing.status)&&existing.authorizedCents===0){existing.authorizedCents=cents;existing.requestedCents=cents;existing.status='AUTHORIZED';existing.provider=provider;existing.providerReference=reference??existing.providerReference;existing.error=null;this.setPayment(r,'AUTHORIZED');return existing;}
  throw new DomainError('Cette location possède déjà une autorisation de paiement.');}const p:Payment={id:`pay-${r.id}`,rentalId:r.id,authorizedCents:cents,capturedCents:0,releasedCents:0,status:'AUTHORIZED',provider,providerReference:reference??null,requestedCents:cents,error:null};d.payments.push(p);this.setPayment(r,'AUTHORIZED');return p;}
 /** Records the Stripe intent created for this rental, before the customer has put a card on it. It authorizes nothing: the payment stays PENDING with a zero authorized amount until the intent is confirmed and read back from Stripe. Idempotent, so a replayed request cannot create a second record. */
 attachIntent(d:Data,rentalId:string,intentId:string,cents:number):Payment {
  const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);
  const existing=this.paymentFor(d,r);if(existing)return existing;
  if(r.state!=='CREATED')throw new DomainError('Cette location ne peut plus recevoir de paiement.',409);
  const p:Payment={id:`pay-${r.id}`,rentalId:r.id,authorizedCents:0,capturedCents:0,releasedCents:0,status:'PENDING',provider:'stripe',providerReference:intentId,requestedCents:cents,error:null};
  d.payments.push(p);return p;
 }
 /** A rental whose customer never confirmed a card must not hold a customer hostage: while it stays open they cannot rent anywhere else. Only ever applies to a rental that has not authorized anything. */
 expireUnconfirmed(d:Data,rentalId:string,now=Date.now(),to:'EXPIRED'|'CANCELLED'='EXPIRED'):Rental {
  const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);
  if(r.state!=='CREATED')return r;
  // The card can have been accepted by Stripe (its webhook may already have marked the payment AUTHORIZED) while the customer
  // never came back to confirm. No ejection has started — the rental is still CREATED — so the hold is simply given back.
  const p=this.paymentFor(d,r);
  if(p){p.releasedCents=p.authorizedCents;p.status='RELEASED';}
  this.setPayment(r,'RELEASED');this.move(d,r,to,to==='EXPIRED'?'Paiement jamais confirmé par le client · demande expirée':'Annulée par le client avant tout paiement',now);
  return r;
 }
 markPaymentAuthorized(d:Data,rentalId:string,cents:number,provider:'mock'|'stripe'='mock',reference?:string,now=Date.now()){const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);if(['PAYMENT_AUTH','EJECTING','ACTIVE'].includes(r.state))return this.paymentFor(d,r)!;if(r.state!=='CREATED')throw new DomainError('La location ne peut plus être autorisée.');const p=this.recordAuthorized(d,r,cents,provider,reference);this.move(d,r,'PAYMENT_AUTH',`Autorisation ${provider==='stripe'?'Stripe':'simulée'} : ${cents} centimes`,now);return p;}
 markPaymentFailed(d:Data,rentalId:string,error:string,provider:'mock'|'stripe'='mock',now=Date.now()){const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);const p=this.paymentFor(d,r)??{id:`pay-${r.id}`,rentalId:r.id,authorizedCents:0,capturedCents:0,releasedCents:0,status:'FAILED' as const,provider,providerReference:null,requestedCents:r.pricing.depositCents,error};if(!this.paymentFor(d,r))d.payments.push(p);p.status='FAILED';p.provider=provider;p.error=error;r.error=error;this.setPayment(r,'FAILED');if(r.state==='CREATED')this.move(d,r,'PAYMENT_FAILED',error,now);return p;}
 beginEjection(d:Data,rentalId:string,now=Date.now()){const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);if(r.state==='ACTIVE')return r;if(r.state!=='PAYMENT_AUTH')throw new DomainError('Le paiement doit être autorisé avant l’éjection.');this.setPayment(r,'AUTHORIZED');r.physicalState='EJECTING';this.move(d,r,'EJECTING','Éjection demandée à la borne',now);return r;}
 activateWithBattery(d:Data,rentalId:string,batteryId:string,now=Date.now()){const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);if(r.state==='ACTIVE')return r;if(r.state!=='EJECTING')throw new DomainError('La location n’est pas en cours d’éjection.');r.batteryId=batteryId;r.startedAt=now;r.deadline=now+r.pricing.deadlineHours*3_600_000;r.physicalState='EJECTED';this.move(d,r,'ACTIVE','Batterie disponible · location active',now);return r;}
 failEjection(d:Data,rentalId:string,error:string,now=Date.now()){const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);r.error=error;r.physicalState='FAILED';if(r.state==='PAYMENT_AUTH')this.move(d,r,'EJECTING','Éjection demandée à la borne',now);if(r.state==='EJECTING')this.move(d,r,'EJECTION_FAILED',error,now);return r;}
 /** The eject command was sent but its outcome could not be confirmed (e.g. provider timeout). Per docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md: stop, never blind-retry. The rental stays EJECTING — neither ACTIVE nor EJECTION_FAILED — and the deposit stays authorized, untouched, until a human reconciles against a read-only provider query and calls activateWithBattery or failEjection explicitly. Idempotent: re-reporting the same uncertainty is a no-op. */
 markEjectionUncertain(d:Data,rentalId:string,error:string,now=Date.now()):Rental {const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);if(r.physicalState==='UNKNOWN')return r;if(r.state==='PAYMENT_AUTH')this.move(d,r,'EJECTING','Éjection demandée à la station',now);if(r.state!=='EJECTING')throw new DomainError('Cette location n’est pas en cours d’éjection.');r.error=error;r.physicalState='UNKNOWN';this.event(d,r,'PHYSICAL_RESULT_UNKNOWN',error,now);return r;}
 /** Manual reconciliation of a markEjectionUncertain() incident, confirmed against a read-only provider query: the battery did leave the station. Only usable on a rental actually marked UNKNOWN — this is not a generic way to assign a battery. The battery must still be sitting AVAILABLE in a slot at the rental's own station: it moves the slot/battery records exactly as ejectBattery() would have, so the station's availability count stays correct. */
 resolveEjectionConfirmed(d:Data,rentalId:string,batteryId:string,now=Date.now()):Rental {
  const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);
  if(r.physicalState!=='UNKNOWN')throw new DomainError('Cette location n’a pas de résultat physique incertain à réconcilier.',409);
  const slot=d.slots.find(s=>s.stationId===r.stationId&&s.batteryId===batteryId);
  const battery=d.batteries.find(b=>b.id===batteryId);
  if(!slot||!battery||battery.status!=='AVAILABLE')throw new DomainError('Cette batterie n’est pas disponible à la station de cette location.',409);
  slot.batteryId=null;battery.status='RENTED';
  return this.activateWithBattery(d,rentalId,batteryId,now);
 }
 /** Manual reconciliation of a markEjectionUncertain() incident: confirmed no battery ever left the station. Fails the rental exactly like a definite ejection failure; the caller (RentalEngine.start()'s synchronous mock path or StripeRentalCoordinator) is still responsible for releasing the authorization. */
 resolveEjectionFailed(d:Data,rentalId:string,now=Date.now()):Rental {
  const r=d.rentals.find(x=>x.id===rentalId);if(!r)throw new DomainError('Location introuvable.',404);
  if(r.physicalState!=='UNKNOWN')throw new DomainError('Cette location n’a pas de résultat physique incertain à réconcilier.',409);
  return this.failEjection(d,rentalId,'Confirmé par réconciliation manuelle : aucune batterie n’a quitté le slot.',now);
 }
 start(d:Data,customerId:string,stationId:string,key:string,now=Date.now(),contactEmail?:string):Rental {const r=this.create(d,customerId,stationId,key,now,contactEmail);if(r.state!=='CREATED')return r;const s=this.station.getStation(d,stationId);const auth=this.payment.authorize(d,r.id,r.pricing.depositCents,s.failure==='payment');if(auth.status==='FAILED'){r.error='L’autorisation de paiement a été refusée. Aucun montant débité.';this.setPayment(r,'FAILED');this.move(d,r,'PAYMENT_FAILED',r.error,now);return r;}this.recordAuthorized(d,r,r.pricing.depositCents,'mock');this.move(d,r,'PAYMENT_AUTH',`Autorisation de ${r.pricing.depositCents} centimes`,now);this.beginEjection(d,r.id,now);try{const batteryId=this.station.ejectBattery(d,s.id);this.event(d,r,'BATTERY_EJECTED',`Batterie ${batteryId} libérée`,now);this.activateWithBattery(d,r.id,batteryId,now);}catch(e){if(e instanceof PhysicalResultUnknownError){this.markEjectionUncertain(d,r.id,e.message,now);return r;}this.payment.release(d,r.id);r.error=e instanceof DomainError?e.message:'Éjection impossible. Caution libérée.';this.event(d,r,'AUTH_RELEASED','Autorisation intégralement libérée',now);this.failEjection(d,r.id,r.error,now);this.setPayment(r,'RELEASED');}return r;}
 /** The cabinet itself confirmed the battery is back in one of its slots, so local bookkeeping
  * follows the hardware instead of vetoing it: neither a station flagged offline locally nor a
  * saturated local slot map may keep the rental open, or the 48 h overdue job would capture the
  * whole deposit for a battery that is physically back. A placement that lands away from the real
  * slot shows up as an ordinary SLOT_MISMATCH on the next read. */
 private placeReturned(d:Data,stationId:string,batteryId:string){
  const battery=d.batteries.find(b=>b.id===batteryId)!;
  const current=d.slots.find(s=>s.batteryId===batteryId);
  if(current?.stationId!==stationId){
   if(current)current.batteryId=null;
   const slot=d.slots.find(s=>s.stationId===stationId&&!s.batteryId)??d.slots.find(s=>!s.batteryId);
   if(!slot)throw new DomainError('Aucun emplacement libre dans le réseau pour enregistrer ce retour.');
   slot.batteryId=batteryId;
  }
  battery.status='AVAILABLE';
 }
 prepareReturn(d:Data,id:string,stationId:string,now=Date.now(),detected=false):Rental {const r=d.rentals.find(r=>r.id===id);if(!r)throw new DomainError('Location introuvable.',404);if(r.state==='COMPLETED'||r.state==='RETURNED')return r;if(r.state==='ERROR'&&r.returnedAt!==null&&r.returnStationId!==null&&r.amountCents>0)return r;if(!['ACTIVE','OVERDUE'].includes(r.state)||!r.batteryId||r.startedAt===null)throw new DomainError('Cette location ne peut pas être restituée.');if(detected)this.placeReturned(d,stationId,r.batteryId);else this.station.returnBattery(d,stationId,r.batteryId);r.physicalState='RETURN_PENDING';this.move(d,r,'RETURN_PENDING',detected?'Retour confirmé par relecture fabricant':'Retour déclaré par le client',now);r.returnedAt=now;r.returnStationId=stationId;r.physicalState='RETURNED';this.move(d,r,'RETURNED','Batterie rendue et identifiée',now);r.amountCents=calculatePrice(now-r.startedAt+r.simulatedMinutes*60_000,r.pricing);r.commissionCents=commission(r.amountCents,r.pricing);this.event(d,r,'PRICE_CALCULATED',`Prix calculé : ${r.amountCents} centimes`,now);if(this.paymentFor(d,r))this.setPayment(r,'CAPTURING');return r;}
 completeSettlement(d:Data,id:string,now=Date.now()){const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);if(r.state==='COMPLETED')return r;if(r.state!=='RETURNED'&&!(r.state==='ERROR'&&r.returnedAt!==null&&r.amountCents>0))throw new DomainError('Le retour doit être confirmé avant la clôture.');this.setPayment(r,'CAPTURED');this.move(d,r,'COMPLETED','Location terminée · reçu disponible',now);return r;}
 markPaymentCaptured(d:Data,id:string,cents:number,providerReference?:string,now=Date.now()){const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);const p=this.paymentFor(d,r);if(!p)throw new DomainError('Autorisation introuvable.');if(p.status==='CAPTURED'){if(p.capturedCents!==cents)throw new DomainError('Capture déjà effectuée avec un autre montant.');return this.completeSettlement(d,id,now);}if(!['AUTHORIZED','CAPTURING','UNKNOWN'].includes(p.status)||cents<0||cents>p.authorizedCents)throw new DomainError('Capture refusée.');p.status='CAPTURED';p.capturedCents=cents;p.releasedCents=p.authorizedCents-cents;p.providerReference=providerReference??p.providerReference;this.setPayment(r,'CAPTURED');this.event(d,r,'PAYMENT_CAPTURED',`Capture ${p.provider==='stripe'?'Stripe':'simulée'} · reste de la caution libéré`,now);return this.completeSettlement(d,id,now);}
 /** Records money actually given back. Deliberately leaves the rental state and `commissionCents`
  * alone: the rental did happen, and the partner's share is frozen in its pricing snapshot by the
  * settlement invariant — reopening it would break the very check that keeps money consistent.
  * Net revenue is therefore capturedCents - refundedCents wherever it is reported. */
 markRefunded(d:Data,id:string,cents:number,reference?:string,now=Date.now()){
  const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);
  const p=this.paymentFor(d,r);if(!p)throw new DomainError('Aucun paiement à rembourser.',404);
  if(p.status!=='CAPTURED')throw new DomainError('Seul un paiement encaissé peut être remboursé.',409);
  const already=p.refundedCents??0;
  if(!Number.isSafeInteger(cents)||cents<=0||already+cents>p.capturedCents)throw new DomainError('Montant de remboursement invalide.',400);
  p.refundedCents=already+cents;if(reference)p.providerReference=p.providerReference??reference;
  this.event(d,r,'PAYMENT_REFUNDED',`Remboursement de ${cents} centimes`,now);
  return r;
 }
 /** A bank dispute is the customer's card issuer pulling the money back; BATYEO cannot stop it and
  * must not pretend the payment is still clean. Recorded so it surfaces in Finance and support. */
 markDisputed(d:Data,id:string,detail:string,now=Date.now()){
  const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);
  const p=this.paymentFor(d,r);if(!p)throw new DomainError('Aucun paiement contesté.',404);
  if(p.disputedAt)return r;
  p.disputedAt=now;this.event(d,r,'PAYMENT_DISPUTED',detail,now);return r;
 }
 markPaymentReleased(d:Data,id:string,now=Date.now()){const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);const p=this.paymentFor(d,r);if(!p)throw new DomainError('Autorisation introuvable.');if(p.status==='RELEASED')return p;if(!['AUTHORIZED','RELEASING','UNKNOWN'].includes(p.status))throw new DomainError('Libération refusée.');p.status='RELEASED';p.releasedCents=p.authorizedCents;p.capturedCents=0;this.setPayment(r,'RELEASED');this.event(d,r,'AUTH_RELEASED','Autorisation intégralement libérée',now);return p;}
 markPaymentUnknown(d:Data,id:string,error:string,now=Date.now()){const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);const p=this.paymentFor(d,r);if(p){p.status='UNKNOWN';p.error=error;}this.setPayment(r,'UNKNOWN');r.error=error;if(['RETURNED','EJECTING','PAYMENT_AUTH','ACTIVE','OVERDUE'].includes(r.state))this.move(d,r,'ERROR',error,now);return r;}
 return(d:Data,id:string,stationId:string,now=Date.now(),detected=false):Rental {const r=this.prepareReturn(d,id,stationId,now,detected);if(r.state==='COMPLETED')return r;const p=this.payment.capture(d,id,r.amountCents);this.setPayment(r,p.status==='CAPTURED'?'CAPTURED':undefined);this.event(d,r,'PAYMENT_CAPTURED','Paiement encaissé · reste de la caution libéré',now);this.completeSettlement(d,id,now);return r;}
 refreshOverdue(d:Data,now=Date.now()){for(const r of d.rentals)if(r.state==='ACTIVE'&&r.deadline!==null&&now+r.simulatedMinutes*60_000>r.deadline)this.move(d,r,'OVERDUE','Délai de restitution de 48 h dépassé · plafond tarifaire inchangé',now);}
 /** Perte définitive : capture intégrale de la caution après 48 h passées en OVERDUE. Idempotent — un rejeu après capture réussie ne fait rien. */
 markDepositLost(d:Data,id:string,cents:number,providerReference?:string,now=Date.now()):Rental {
  const r=d.rentals.find(x=>x.id===id);if(!r)throw new DomainError('Location introuvable.',404);
  const p=this.paymentFor(d,r);if(!p)throw new DomainError('Autorisation introuvable.');
  if(p.status==='CAPTURED'){
   if(p.capturedCents!==cents)throw new DomainError('Capture déjà effectuée avec un autre montant.');
   if(r.state==='LOST')return r;
   throw new DomainError('Cette location n’est plus en retard : elle a été restituée entre-temps.',409);
  }
  if(r.state!=='OVERDUE')throw new DomainError('Cette location n’est plus en retard : elle a été restituée entre-temps.',409);
  if(!overdueLossEligible(r,now))throw new DomainError('Cette location n’est pas éligible à une perte définitive.');
  if(!['AUTHORIZED','CAPTURING','UNKNOWN'].includes(p.status)||cents<0||cents>p.authorizedCents)throw new DomainError('Capture refusée.');
  p.status='CAPTURED';p.capturedCents=cents;p.releasedCents=p.authorizedCents-cents;
  p.providerReference=providerReference??p.providerReference;
  this.setPayment(r,'CAPTURED');
  if(r.batteryId){const b=d.batteries.find(b=>b.id===r.batteryId);if(b)b.status='LOST';}
  this.event(d,r,'PAYMENT_CAPTURED',`Capture intégrale de la caution (${cents} centimes) · batterie jamais restituée`,now);
  this.move(d,r,'LOST','Perte définitive constatée après 48 h de retard non résolu',now);
  return r;
 }
}
