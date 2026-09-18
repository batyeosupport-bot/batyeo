import {PAYMENT_STATES,PHYSICAL_STATES,type Data} from './types';
import type {PricingStrategy} from './pricing';
import {calculatePrice,commission} from './pricing';
import {OPEN_STATES} from './rental';
import {STATES} from './state-machine';
function ensure(ok:unknown,name:string):asserts ok {if(!ok)throw new Error(`Invariant failed: ${name}`);}
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
export function validatePricing(p:PricingStrategy){
 ensure(!!p&&!!p.id,'missing pricing version');
 ensure([p.hourlyCents,p.capCents,p.depositCents,p.deadlineHours].every(n=>integer(n,1)),'pricing integers');
 ensure(p.hourlyCents<=p.capCents&&p.capCents<=p.depositCents,'pricing bounds');
 ensure(integer(p.commissionBps)&&p.commissionBps<=10_000,'commission rate');
}
export function validateData(d:Data):void {
 const unique=(xs:string[],name:string)=>ensure(new Set(xs).size===xs.length,name);
 for(const [name,rows] of Object.entries(d))unique(rows.map((r:{id:string})=>r.id),`${name} duplicate primary key`);
 unique(d.users.map(u=>u.email.toLowerCase()),'duplicate user email');
 unique(d.stations.map(s=>s.publicId),'duplicate station public ID');
 unique(d.partnerUsers.map(m=>`${m.userId}:${m.partnerId}`),'duplicate membership');
 unique(d.slots.map(s=>`${s.stationId}:${s.position}`),'duplicate station slot');
 unique(d.slots.flatMap(s=>s.batteryId?[s.batteryId]:[]),'battery in multiple slots');
 unique(d.rentals.filter(r=>OPEN_STATES.includes(r.state)).map(r=>r.customerId),'multiple open rentals per customer');
 unique(d.rentals.filter(r=>OPEN_STATES.includes(r.state)).flatMap(r=>r.batteryId?[r.batteryId]:[]),'multiple open rentals per battery');
 unique(d.payments.map(p=>p.rentalId),'duplicate payment');unique(d.terms.map(t=>t.rentalId),'duplicate terms');
 unique(d.webhookEvents.map(e=>`${e.source}:${e.externalId}`),'duplicate webhook event');
 unique(d.stationProviderLinks.map(link=>`${link.manufacturer}:${link.externalId}`),'duplicate manufacturer external ID');
 unique(d.stationProviderLinks.filter(link=>link.active).map(link=>`${link.stationId}:${link.manufacturer}`),'multiple active manufacturer links');
 unique(d.stationProviderSnapshots.map(snapshot=>snapshot.linkId),'multiple latest provider snapshots');
 unique(d.rentals.map(r=>r.customerId+':'+r.idempotencyKey),'duplicate idempotency key');
 ensure(d.pricing.length<=1,'multiple active pricing versions');
 for(const p of d.pricing)validatePricing(p);
 for(const m of d.partnerUsers){ensure(d.users.some(u=>u.id===m.userId)&&d.partners.some(p=>p.id===m.partnerId),'orphan membership');}
 for(const v of d.venues)ensure(d.partners.some(p=>p.id===v.partnerId),'orphan venue');
 for(const s of d.stations){ensure(d.venues.some(v=>v.id===s.venueId&&v.partnerId===s.partnerId),'station tenant');ensure(integer(s.capacity,1),'station capacity');if(s.provider)ensure(['mock','manufacturer'].includes(s.provider),'station provider');if(s.providerLastSyncedAt!=null)ensure(integer(s.providerLastSyncedAt),'manufacturer sync timestamp');if(s.lastSeenAt!=null)ensure(integer(s.lastSeenAt),'manufacturer last seen timestamp');if(s.stripeTerminalLocationId!=null)ensure(/^tml_[a-zA-Z0-9]{1,255}$/.test(s.stripeTerminalLocationId),'stripe terminal location id');if(s.stripeTerminalLocationUpdatedAt!=null)ensure(integer(s.stripeTerminalLocationUpdatedAt),'stripe terminal location timestamp');}
 for(const link of d.stationProviderLinks){ensure(d.stations.some(s=>s.id===link.stationId),'orphan manufacturer link');ensure(link.manufacturer==='BAJIE','unknown manufacturer');ensure(link.externalId.length>0&&integer(link.createdAt)&&integer(link.updatedAt),'manufacturer link');}
 for(const snapshot of d.stationProviderSnapshots){ensure(d.stations.some(s=>s.id===snapshot.stationId)&&d.stationProviderLinks.some(link=>link.id===snapshot.linkId&&link.stationId===snapshot.stationId),'orphan provider snapshot');ensure(integer(snapshot.syncedAt)&&[snapshot.totalSlots,snapshot.emptySlots,snapshot.busySlots,snapshot.availability].every(n=>integer(n)),'provider snapshot');}
 for(const record of d.reconciliationRecords){ensure(d.stations.some(s=>s.id===record.stationId)&&d.stationProviderLinks.some(link=>link.id===record.linkId&&link.stationId===record.stationId),'orphan reconciliation');ensure(['OPEN','RESOLVED'].includes(record.status)&&integer(record.firstDetectedAt)&&integer(record.lastDetectedAt),'reconciliation record');}
 for(const run of d.manufacturerSyncRuns){ensure(run.provider==='BAJIE'&&integer(run.startedAt)&&integer(run.total)&&integer(run.succeeded)&&integer(run.failed)&&integer(run.mismatches)&&run.succeeded+run.failed<=run.total&&run.errorSummary.every(error=>error.stationId&&error.kind),'manufacturer sync run');}
 for(const s of d.slots){const station=d.stations.find(st=>st.id===s.stationId);ensure(station&&integer(s.position,1)&&s.position<=station.capacity,'slot bounds');ensure(s.batteryId===null||d.batteries.some(b=>b.id===s.batteryId),'orphan slot battery');}
 for(const r of d.rentals){
  ensure(d.stations.some(s=>s.id===r.stationId&&s.partnerId===r.partnerId),'rental tenant');
  ensure(STATES.includes(r.state),'rental state');validatePricing(r.pricing);
  if(r.paymentState)ensure(PAYMENT_STATES.includes(r.paymentState),'rental payment state');
  if(r.physicalState)ensure(PHYSICAL_STATES.includes(r.physicalState),'rental physical state');
  ensure(integer(r.amountCents)&&r.amountCents<=r.pricing.capCents&&integer(r.commissionCents)&&r.commissionCents<=r.amountCents,'rental amounts');
  ensure(integer(r.simulatedMinutes),'simulated duration');
  ensure(r.batteryId===null||d.batteries.some(b=>b.id===r.batteryId),'orphan rental battery');
  ensure(r.returnStationId===null||d.stations.some(s=>s.id===r.returnStationId),'return station');
  if(['ACTIVE','OVERDUE','RETURN_PENDING','RETURNED','COMPLETED','LOST'].includes(r.state))ensure(r.batteryId&&r.startedAt!==null&&r.deadline===r.startedAt+r.pricing.deadlineHours*3600000,'rental start/deadline');
  if(r.state==='LOST'){const p=d.payments.find(p=>p.rentalId===r.id);ensure(p?.status==='CAPTURED'&&p.capturedCents===p.authorizedCents,'lost rental deposit fully captured');}
  if(['ACTIVE','OVERDUE','RETURN_PENDING'].includes(r.state)){const p=d.payments.find(p=>p.rentalId===r.id);if(p)ensure(!['RELEASED','FAILED'].includes(p.status),'deposit released/failed on a rental that is still holding a battery');}
  if(r.state==='COMPLETED'){
   ensure(r.startedAt!==null&&r.returnedAt!==null&&r.returnedAt>=r.startedAt&&r.returnStationId,'completed rental timestamps');
   ensure(r.amountCents===calculatePrice(r.returnedAt!-r.startedAt!+r.simulatedMinutes*60000,r.pricing),'completed price');
   ensure(r.commissionCents===commission(r.amountCents,r.pricing),'completed commission');
   const p=d.payments.find(p=>p.rentalId===r.id);ensure(p?.status==='CAPTURED'&&p.capturedCents===r.amountCents&&p.authorizedCents===r.pricing.depositCents,'completed payment');
  }
 }
 for(const p of d.payments){ensure(d.rentals.some(r=>r.id===p.rentalId),'orphan payment');ensure(PAYMENT_STATES.includes(p.status),'payment state');ensure([p.authorizedCents,p.capturedCents,p.releasedCents].every(n=>integer(n))&&p.capturedCents+p.releasedCents<=p.authorizedCents,'money conservation');if(['CAPTURED','RELEASED'].includes(p.status))ensure(p.capturedCents+p.releasedCents===p.authorizedCents,'settled authorization');if(p.status==='RELEASED')ensure(p.capturedCents===0,'released capture');if(p.requestedCents!==undefined)ensure(integer(p.requestedCents,1),'requested payment amount');}
 for(const b of d.batteries){const slots=d.slots.filter(s=>s.batteryId===b.id);ensure(integer(b.charge)&&b.charge<=100,'battery charge');ensure(b.status==='RENTED'||b.status==='LOST'?slots.length===0:slots.length===1,'battery location');if(b.status==='RENTED')ensure(d.rentals.some(r=>r.batteryId===b.id&&OPEN_STATES.includes(r.state)),'rented battery without rental');if(b.status==='LOST')ensure(d.rentals.some(r=>r.batteryId===b.id&&r.state==='LOST'),'lost battery without rental');}
 for(const e of [...d.events,...d.terms])ensure(d.rentals.some(r=>r.id===e.rentalId),'orphan rental event/terms');
 for(const t of d.tickets){ensure(t.partnerId===null||d.partners.some(p=>p.id===t.partnerId),'ticket tenant');if(t.rentalId)ensure(d.rentals.some(r=>r.id===t.rentalId&&(!t.partnerId||r.partnerId===t.partnerId)),'ticket rental');if(t.stationId)ensure(d.stations.some(s=>s.id===t.stationId),'ticket station');if(t.batteryId)ensure(d.batteries.some(b=>b.id===t.batteryId),'ticket battery');if(t.paymentId)ensure(d.payments.some(p=>p.id===t.paymentId),'ticket payment');}
 for(const s of d.sessions)ensure(d.users.some(u=>u.id===s.userId),'orphan operator session');
}
