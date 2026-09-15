import type {RentalState} from './state-machine';

export type RentalProviderState='ACTIVE'|'RETURNED'|'CAPTURED'|'UNKNOWN';
export type RentalDiscrepancy='ACTIVE_BUT_PROVIDER_RETURNED'|'COMPLETED_BUT_CAPTURE_MISSING'|'CAPTURE_WITHOUT_COMPLETED'|'AUTHORIZATION_OPEN_AFTER_EJECTION_FAILURE'|'CAPTURE_AMOUNT_MISMATCH'|'PAYMENT_EVENT_MISSING'|'PROVIDER_UNAVAILABLE'|null;

/** Read-only comparison used by scheduled reconciliation jobs. It never mutates a rental. */
export function reconcileRental(local:RentalState,provider:RentalProviderState,paymentCapturedCents:number,amountCents:number):RentalDiscrepancy{
 if(provider==='UNKNOWN')return 'PROVIDER_UNAVAILABLE';
 if(['ACTIVE','OVERDUE','RETURN_PENDING'].includes(local)&&provider==='RETURNED')return 'ACTIVE_BUT_PROVIDER_RETURNED';
 if(local==='COMPLETED'&&paymentCapturedCents<amountCents)return 'COMPLETED_BUT_CAPTURE_MISSING';
 return null;
}

export interface ReconciliationSnapshot {
 rentalState:RentalState;
 paymentStatus:'PENDING'|'AUTHORIZING'|'AUTHORIZED'|'CAPTURING'|'CAPTURED'|'RELEASING'|'RELEASED'|'FAILED'|'UNKNOWN';
 authorizedCents:number;
 capturedCents:number;
 amountCents:number;
 providerState:RentalProviderState;
 providerEventSeen?:boolean;
}
/** Pure, read-only BATYEO ↔ Stripe/station divergence detection. */
export function reconcileSnapshot(input:ReconciliationSnapshot):RentalDiscrepancy {
 const base=reconcileRental(input.rentalState,input.providerState,input.capturedCents,input.amountCents);if(base)return base;
 if(input.rentalState==='COMPLETED'&&input.paymentStatus==='CAPTURED'&&input.capturedCents!==input.amountCents)return 'CAPTURE_AMOUNT_MISMATCH';
 if(input.rentalState==='COMPLETED'&&input.paymentStatus==='CAPTURED'&&input.capturedCents===input.amountCents&&!input.providerEventSeen)return 'PAYMENT_EVENT_MISSING';
 if(input.rentalState==='EJECTION_FAILED'&&['AUTHORIZED','CAPTURING','AUTHORIZING'].includes(input.paymentStatus))return 'AUTHORIZATION_OPEN_AFTER_EJECTION_FAILURE';
 if(input.paymentStatus==='CAPTURED'&&input.rentalState!=='COMPLETED')return 'CAPTURE_WITHOUT_COMPLETED';
 return null;
}
