import type {Actor,Data,Rental} from './types';
import {teamFor} from './accounts';
import {authorize,inTenant} from './rental';
import {calculatePrice} from './pricing';
import {providerHealth} from './manufacturer-sync';
import {cappedAvailability,DomainError} from './providers';
import type {StationDisplayConfig,StationPublicSnapshot} from './station-runtime';
import {activePlaylist} from './media';
import type {PaymentMode} from './payment-mode';
import {heartbeatHealth} from './heartbeat';
import {evaluateAlerts} from './ops-alerts';
export function stationViews(d:Data,now=Date.now()){return d.stations.map(s=>({...s,venue:d.venues.find(v=>v.id===s.venueId)!,available:cappedAvailability(d,s.id,d.slots.filter(slot=>slot.stationId===s.id&&d.batteries.some(b=>b.id===slot.batteryId&&b.status==='AVAILABLE')).length,now),freeSlots:d.slots.filter(slot=>slot.stationId===s.id&&!slot.batteryId).length}));}
/** Plain Error() here used to reach handle()'s generic 503 instead of a clean 404 — harmless while every caller already validated the station, but reachable the moment an unvalidated customer-supplied id (e.g. a stale QR code) reaches it. */
export function stationDisplaySnapshot(d:Data,stationId:string):StationPublicSnapshot {const station=stationViews(d).find(row=>row.id===stationId||row.publicId===stationId);if(!station)throw new DomainError('Station introuvable.',404);const pricing=d.pricing[0];if(!pricing)throw new DomainError('Tarification indisponible.',503);return {stationId:station.id,publicId:station.publicId,venueName:station.venue.name,online:station.online,availableBatteries:station.available,capacity:station.capacity,hourlyCents:pricing.hourlyCents,capCents:pricing.capCents,depositCents:pricing.depositCents,qrTarget:`/rent/${station.publicId}`,providerHealth:providerHealth(d).status};}
/**
 * Display configuration served to a station runtime: admin-owned text and flags,
 * the translation pack, the media playlist filtered to what is published, in its
 * scheduling window, and targeted at this station, and the Stripe Terminal
 * Location its card reader should connect to. `version` is the most recent
 * change timestamp across those inputs, so it only moves forward and a runtime
 * holding a newer config never downgrades itself.
 */
export function displayConfigFor(d:Data,stationId:string):StationDisplayConfig {
 const station=d.stations.find(row=>row.id===stationId||row.publicId===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 const venue=d.venues.find(row=>row.id===station.venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
 const stored=d.displayConfigs.find(row=>row.stationId===station.id);
 const version=Math.max(stored?.updatedAt??0,d.media.reduce((latest,item)=>Math.max(latest,item.updatedAt??item.createdAt),0),station.stripeTerminalLocationUpdatedAt??0,1);
 const issuedAt=Date.now(),checksum=`live-${version}`;
 const items=activePlaylist({version,items:d.media,issuedAt,checksum},station.id);
 return {version,venueName:venue.name,locale:stored?.locale??'fr-FR',idleContent:stored?.idleContent??'',supportContact:stored?.supportContact??'',maintenanceBanner:stored?.maintenanceBanner??null,refreshIntervalMs:stored?.refreshIntervalMs??15_000,featureFlags:stored?.featureFlags??{},advertisingSlots:items.map(item=>item.id),playlist:{version,items,issuedAt,checksum},translations:stored?.translations??null,stripeTerminalLocationId:station.stripeTerminalLocationId??null};
}
export const canViewFinance=(actor:Actor)=>['SUPER_ADMIN','ADMIN','FINANCE','PARTNER_ADMIN'].includes(actor.role);
/** `contact` is opt-in and off by default: a customer's address is BATYEO's to act on, not a
 * partner's to harvest — a venue owner sees the rentals on their own cabinets, never who made them. */
export function rentalView(d:Data,r:Rental,financial=true,contact=false){const elapsedMs=r.startedAt===null?0:Math.max(0,(r.returnedAt??Date.now())-r.startedAt+r.simulatedMinutes*60_000);return {...r,commissionCents:financial?r.commissionCents:undefined,contactEmail:contact?r.contactEmail??null:undefined,customerId:undefined,idempotencyKey:undefined,elapsedMs,currentCents:r.startedAt===null?0:calculatePrice(elapsedMs,r.pricing),station:stationViews(d).find(s=>s.id===r.stationId),events:d.events.filter(e=>e.rentalId===r.id),payment:financial?d.payments.find(p=>p.rentalId===r.id):undefined};}
export function customerRentalView(d:Data,r:Rental){const view=rentalView(d,r,false);const payment=d.payments.find(p=>p.rentalId===r.id);return {...view,payment:payment?{authorizedCents:payment.authorizedCents,capturedCents:payment.capturedCents,releasedCents:payment.releasedCents,status:payment.status}:undefined};}
/** `meta` carries what the deployment actually is. It used to be hardcoded `demo:true`, so a real
 * deployment kept telling its own operators the data was fake. */
export function dashboard(d:Data,actor:Actor,meta:{demo:boolean;payment:PaymentMode}={demo:false,payment:'mock'}){
 authorize(actor,'read');const stations=stationViews(d).filter(s=>inTenant(actor,s.partnerId));const rentals=d.rentals.filter(r=>inTenant(actor,r.partnerId));const ids=new Set(rentals.map(r=>r.id));const stationIds=new Set(stations.map(s=>s.id));const batteryIds=new Set([...d.slots.filter(s=>stationIds.has(s.stationId)).map(s=>s.batteryId),...rentals.filter(r=>['ACTIVE','OVERDUE','LOST'].includes(r.state)).map(r=>r.batteryId)]);
 const canFinance=canViewFinance(actor);
 return {user:{...actor,name:d.users.find(u=>u.id===actor.id)?.name,email:d.users.find(u=>u.id===actor.id)?.email},stations,partners:d.partners.filter(p=>inTenant(actor,p.id)),venues:d.venues.filter(v=>inTenant(actor,v.partnerId)),rentals:rentals.map(r=>rentalView(d,r,canFinance,!actor.role.startsWith('PARTNER_'))),batteries:d.batteries.filter(b=>batteryIds.has(b.id)),slots:d.slots.filter(s=>stationIds.has(s.stationId)),payments:canFinance?d.payments.filter(p=>ids.has(p.rentalId)):[],pricing:d.pricing[0],tickets:d.tickets.filter(t=>inTenant(actor,t.partnerId)),audits:actor.role.startsWith('PARTNER_')?[]:d.audits.slice(-50).reverse(),providerLinks:d.stationProviderLinks.filter(link=>stationIds.has(link.stationId)),providerSnapshots:d.stationProviderSnapshots.filter(snapshot=>stationIds.has(snapshot.stationId)),reconciliationRecords:d.reconciliationRecords.filter(record=>stationIds.has(record.stationId)),manufacturerSyncRuns:actor.role.startsWith('PARTNER_')?[]:d.manufacturerSyncRuns.slice(-20).reverse(),manufacturerHealth:actor.role.startsWith('PARTNER_')?{status:'UNKNOWN',lastSyncAt:null,recentFailures:0,openMismatches:d.reconciliationRecords.filter(record=>stationIds.has(record.stationId)&&record.status==='OPEN').length}:providerHealth(d),alerts:evaluateAlerts(d).filter(alert=>alert.stationId===null||stationIds.has(alert.stationId)),media:actor.role==='PARTNER_ADMIN'?d.media.filter(m=>m.targetStationIds.length>0&&m.targetStationIds.every(id=>stationIds.has(id))):actor.role.startsWith('PARTNER_')?[]:d.media,runtimeCredentials:d.runtimeCredentials.filter(row=>stationIds.has(row.stationId)).map(row=>({id:row.id,runtimeId:row.runtimeId,stationId:row.stationId,version:row.version,createdAt:row.createdAt,lastUsedAt:row.lastUsedAt,revokedAt:row.revokedAt})),displayConfigs:d.displayConfigs.filter(row=>stationIds.has(row.stationId)),heartbeats:d.stationHeartbeats.filter(row=>stationIds.has(row.stationId)).map(row=>({...row,health:heartbeatHealth(row)})),team:teamFor(d,actor),serverTime:Date.now(),demo:meta.demo,payment:meta.payment};
}
