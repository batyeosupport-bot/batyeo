import type {Data, Payment, Station} from './types';
export class DomainError extends Error { constructor(message:string, public status=409) { super(message); } }
/** A physical station provider throws this — instead of a plain DomainError — when a command was sent but its outcome could not be confirmed (e.g. a network timeout after dispatch). It must never be treated as a definite failure: the caller has to stop, mark the rental for manual reconciliation, and never blind-retry. See docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md. */
export class PhysicalResultUnknownError extends DomainError { constructor(message:string) { super(message,503); } }
export interface PaymentProvider {
 authorize(data:Data,rentalId:string,cents:number,fail?:boolean):Payment;
 capture(data:Data,rentalId:string,cents:number):Payment;
 release(data:Data,rentalId:string):Payment;
}
/** Deterministic mock operations run inside the repository transaction. No external side effects. */
export class MockPaymentProvider implements PaymentProvider {
 authorize(data:Data,rentalId:string,cents:number,fail=false):Payment {
  const found=data.payments.find(p=>p.rentalId===rentalId); if(found) return found;
  if (!Number.isSafeInteger(cents)||cents<=0) throw new DomainError('Montant invalide.');
  const payment:Payment={id:`pay-${rentalId}`,rentalId,authorizedCents:fail?0:cents,capturedCents:0,releasedCents:0,status:fail?'FAILED':'AUTHORIZED',provider:'mock',providerReference:null,requestedCents:cents,error:fail?'Mock authorization failed':null};
  data.payments.push(payment); return payment;
 }
 capture(data:Data,rentalId:string,cents:number):Payment {
  const p=data.payments.find(p=>p.rentalId===rentalId); if(!p) throw new DomainError('Autorisation introuvable.');
  if(p.status==='CAPTURED'&&p.capturedCents===cents) return p;
  if(p.status==='CAPTURED'&&p.capturedCents!==cents) throw new DomainError('Capture déjà effectuée avec un autre montant.');
  if(!['AUTHORIZED','CAPTURING'].includes(p.status)||!Number.isSafeInteger(cents)||cents<0||cents>p.authorizedCents) throw new DomainError('Capture refusée.');
  p.status='CAPTURING';p.capturedCents=cents;p.releasedCents=p.authorizedCents-cents;p.status='CAPTURED';return p;
 }
 release(data:Data,rentalId:string):Payment {
  const p=data.payments.find(p=>p.rentalId===rentalId);if(!p) throw new DomainError('Autorisation introuvable.');
  if(p.status==='RELEASED')return p;
  if(!['AUTHORIZED','RELEASING'].includes(p.status))throw new DomainError('Libération refusée.');
  p.status='RELEASING';
  p.releasedCents=p.authorizedCents;p.status='RELEASED';return p;
 }
}
export interface BatteryStationProvider {
 getStation(data:Data,id:string):Station;
 getAvailability(data:Data,id:string):number;
 ejectBattery(data:Data,id:string):string;
 returnBattery(data:Data,stationId:string,batteryId:string):void;
 setOnline(data:Data,id:string,online:boolean):void;
 simulateFailure(data:Data,id:string,mode:Station['failure']):void;
}
export class MockBatteryStationProvider implements BatteryStationProvider {
 getStation(d:Data,id:string) {const s=d.stations.find(s=>s.id===id||s.publicId===id);if(!s)throw new DomainError('Station introuvable.',404);return s;}
 getAvailability(d:Data,id:string) {const s=this.getStation(d,id);return d.slots.filter(slot=>slot.stationId===s.id&&d.batteries.some(b=>b.id===slot.batteryId&&b.status==='AVAILABLE')).length;}
 ejectBattery(d:Data,id:string) {
  const s=this.getStation(d,id);
  if(!s.online)throw new DomainError('Cette station est hors ligne. Aucune somme débitée.');
  if(s.failure==='timeout')throw new DomainError('La station ne répond pas. Autorisation annulée.');
  if(s.failure==='ejection')throw new DomainError('La batterie n’a pas pu être libérée. Autorisation annulée.');
  const slot=d.slots.find(slot=>slot.stationId===s.id&&d.batteries.some(b=>b.id===slot.batteryId&&b.status==='AVAILABLE'));
  const b=d.batteries.find(b=>b.id===slot?.batteryId);if(!slot||!b)throw new DomainError('Aucune batterie disponible.');
  slot.batteryId=null;b.status='RENTED';return b.id;
 }
 returnBattery(d:Data,stationId:string,batteryId:string) {
  const s=this.getStation(d,stationId);if(!s.online)throw new DomainError('La station de retour est hors ligne.');
  const existing=d.slots.find(slot=>slot.batteryId===batteryId);if(existing){if(existing.stationId===s.id)return;throw new DomainError('Batterie déjà présente dans une autre station.');}
  const slot=d.slots.find(slot=>slot.stationId===s.id&&!slot.batteryId);const b=d.batteries.find(b=>b.id===batteryId);
  if(!slot||!b)throw new DomainError('Aucun emplacement libre. Choisissez une autre station.');
  slot.batteryId=b.id;b.status='AVAILABLE';b.charge=65;
 }
 setOnline(d:Data,id:string,online:boolean){this.getStation(d,id).online=online;}
 simulateFailure(d:Data,id:string,mode:Station['failure']){this.getStation(d,id).failure=mode;}
}
