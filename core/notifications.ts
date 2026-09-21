import type {Data,Rental} from './types';
import type {Mailer} from './mailer';
import type {Repository} from './repository';
import {OVERDUE_LOSS_GRACE_MS} from './rental';
import {evaluateAlerts} from './ops-alerts';
import {euro} from './pricing';

export type NoticeKind='RECEIPT'|'OVERDUE_WARNING'|'LOSS_NOTICE';
export interface Notice {rentalId:string;kind:NoticeKind;to:string;subject:string;text:string;}
const PREFIX='NOTICE_SENT';
const ref=(r:Rental)=>r.id.slice(0,8).toUpperCase();
const day=(ms:number)=>new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(ms);

/** The timeline is visible to partners, so the marker records *that* a message went out, never to whom. */
export const noticeAlreadySent=(d:Data,rentalId:string,kind:NoticeKind)=>d.events.some(e=>e.rentalId===rentalId&&e.type===PREFIX&&e.detail.startsWith(kind));
/** A warning sent seconds before the capture is not a warning. The customer must have had a full day to react. */
export const WARNING_LEAD_MS=24*3_600_000;
export function warnedLongEnough(d:Data,rental:Rental,now:number):boolean{
 const sent=d.events.find(e=>e.rentalId===rental.id&&e.type===PREFIX&&e.detail.startsWith('OVERDUE_WARNING'));
 return !!sent&&sent.at<=now-WARNING_LEAD_MS;
}

/** When the deposit will be captured if the battery is still out: the deadline plus the 48 h grace, mirroring overdueLossEligible. */
export const lossDeadline=(r:Rental)=>r.deadline===null?null:r.deadline+OVERDUE_LOSS_GRACE_MS-r.simulatedMinutes*60_000;

export function planCustomerNotices(d:Data,only?:ReadonlySet<string>):Notice[]{
 const out:Notice[]=[];
 for(const r of d.rentals){
  if(!r.contactEmail||(only&&!only.has(r.id)))continue;
  const payment=d.payments.find(p=>p.rentalId===r.id);
  if(r.state==='COMPLETED'&&!noticeAlreadySent(d,r.id,'RECEIPT')){
   out.push({rentalId:r.id,kind:'RECEIPT',to:r.contactEmail,subject:`Votre reçu BATYEO · #${ref(r)}`,text:`Bonjour,\n\nMerci d’avoir utilisé BATYEO. Votre batterie a bien été rendue.\n\nRéférence : #${ref(r)}\nMontant encaissé : ${euro(payment?.capturedCents??r.amountCents)}\nCaution libérée : ${euro(payment?.releasedCents??0)}\n\nUne question ? Répondez via le formulaire d’assistance du site en indiquant votre référence.\n\nL’équipe BATYEO`});
  }else if(r.state==='OVERDUE'&&!noticeAlreadySent(d,r.id,'OVERDUE_WARNING')){
   const at=lossDeadline(r);
   out.push({rentalId:r.id,kind:'OVERDUE_WARNING',to:r.contactEmail,subject:`Votre batterie BATYEO doit être rendue · #${ref(r)}`,text:`Bonjour,\n\nLe délai de restitution de votre batterie est dépassé.\n\nRendez-la dès que possible dans n’importe quelle borne BATYEO : le prix ne dépasse pas son plafond.\n${at?`Si elle n’est pas rendue avant le ${day(at)}, la caution de ${euro(r.pricing.depositCents)} sera intégralement débitée.\n`:''}\nRéférence : #${ref(r)}\n\nL’équipe BATYEO`});
  }else if(r.state==='LOST'&&!noticeAlreadySent(d,r.id,'LOSS_NOTICE')){
   out.push({rentalId:r.id,kind:'LOSS_NOTICE',to:r.contactEmail,subject:`Votre caution a été débitée · #${ref(r)}`,text:`Bonjour,\n\nLa batterie n’ayant pas été rendue dans le délai prévu, la caution de ${euro(payment?.capturedCents??r.pricing.depositCents)} a été débitée.\n\nSi vous l’avez rapportée entre-temps, contactez-nous avec la référence #${ref(r)} : un remboursement reste possible.\n\nL’équipe BATYEO`});
  }
 }
 return out;
}

/**
 * Sends what is due and records each success. A failed send records nothing, so it is retried on the
 * next run instead of being lost — and, for the overdue warning, so that the deposit is not captured
 * on a customer who was never actually told.
 */
export async function deliverNotices(repository:Repository,mailer:Mailer,now=Date.now(),only?:ReadonlySet<string>):Promise<{sent:number;failed:number}>{
 const notices=planCustomerNotices(await repository.read(),only);let sent=0,failed=0;
 for(const notice of notices){
  try{
   await mailer.send({to:notice.to,subject:notice.subject,text:notice.text});
   await repository.transaction(d=>{if(!noticeAlreadySent(d,notice.rentalId,notice.kind))d.events.push({id:crypto.randomUUID(),rentalId:notice.rentalId,at:now,type:PREFIX,detail:`${notice.kind} · message envoyé au client`});});
   sent++;
  }catch{failed++;}
 }
 return {sent,failed};
}

/** One mail per day, and only when there is something to act on: an empty digest teaches you to ignore it. */
export function planOpsDigest(d:Data,now=Date.now()):{subject:string;text:string}|null{
 const urgent=evaluateAlerts(d,now).filter(a=>a.severity==='CRITICAL'||a.severity==='HIGH');
 const tickets=d.tickets.filter(t=>t.status==='OPEN');
 if(!urgent.length&&!tickets.length)return null;
 const lines=[...urgent.map(a=>`• [${a.severity}] ${a.message}`),...(tickets.length?[`• ${tickets.length} demande(s) d’assistance ouverte(s)`]:[])];
 return {subject:`BATYEO · ${urgent.length+(tickets.length?1:0)} point(s) à traiter`,text:`Résumé du ${day(now)}\n\n${lines.join('\n')}\n\nOuvrez l’admin pour les traiter.`};
}
