import type {Data,Station,Venue} from './types';
import {DomainError} from './providers';
import {OPEN_STATES} from './rental';
export interface CreateStationInput {partnerId:string;venueId:string;publicId:string;capacity:number;}
export function createStation(d:Data,input:CreateStationInput):Station {if(!input.publicId||!/^[a-z0-9-]{3,64}$/.test(input.publicId))throw new DomainError('Identifiant public invalide.',400);if(input.capacity<1||input.capacity>500)throw new DomainError('Capacité invalide.',400);if(d.stations.some(s=>s.publicId===input.publicId))throw new DomainError('Identifiant public déjà utilisé.',409);if(!d.partners.some(p=>p.id===input.partnerId)||!d.venues.some(v=>v.id===input.venueId&&v.partnerId===input.partnerId))throw new DomainError('Établissement ou partenaire invalide.',404);const station:Station={id:crypto.randomUUID(),publicId:input.publicId,venueId:input.venueId,partnerId:input.partnerId,online:false,failure:'none',capacity:input.capacity,provider:'mock',providerDeviceId:null,providerStatus:'UNKNOWN',providerLastSyncedAt:null,lastSeenAt:null,stripeTerminalLocationId:null};d.stations.push(station);for(let i=1;i<=input.capacity;i++)d.slots.push({id:`${station.id}-${i}`,stationId:station.id,position:i,batteryId:null});return station;}
export function publicQrUrl(origin:string,publicId:string){return `${origin.replace(/\/$/,'')}/rent/${encodeURIComponent(publicId)}`;}
/**
 * Stripe Terminal Location IDs are always prefixed `tml_`; the kiosk otherwise has no way to
 * catch a copy-paste mistake before it tries to pair a reader. `stripeTerminalLocationUpdatedAt`
 * is what displayConfigFor() folds into the runtime config version, so a station picks up a new
 * (or cleared) Location on its very next poll instead of being stuck on a stale cached one.
 */
export function setStripeTerminalLocation(d:Data,stationId:string,locationId:string|null,now=Date.now()):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 if(locationId!==null&&!/^tml_[a-zA-Z0-9]{1,255}$/.test(locationId))throw new DomainError('Identifiant de Location Stripe invalide (attendu : tml_…).',400);
 station.stripeTerminalLocationId=locationId;station.stripeTerminalLocationUpdatedAt=now;return station;
}
/**
 * Remote maintenance switch, independent of online/failure (those carry other meaning read by
 * the manufacturer sync and kiosk runtime). Distinct from the manufacturer's own "No Lease" — this
 * is BATYEO's own server-side gate and blocks RentalEngine.create() regardless of what any
 * provider-side switch is set to.
 */
export function blockStationRentals(d:Data,stationId:string,reason:string,now=Date.now()):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 const trimmed=reason.trim();if(!trimmed||trimmed.length>500)throw new DomainError('Motif de blocage invalide.',400);
 station.rentalsBlocked=true;station.rentalsBlockedReason=trimmed;station.rentalsBlockedAt=now;return station;
}
export function unblockStationRentals(d:Data,stationId:string):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 station.rentalsBlocked=false;station.rentalsBlockedReason=null;station.rentalsBlockedAt=null;return station;
}
/**
 * A physical unit's history (past rentals, provider links, reconciliation records) all reference
 * the station's id, so this never deletes the row — that would either orphan that history or
 * force a destructive cascade neither this codebase nor its Postgres adapter supports (sync()
 * throws on any row disappearing from a write; see infrastructure/postgres/repository.ts).
 * Archiving hides the station from the public API and the kiosk (see stationViews call sites)
 * while keeping it fully intact for admin, audit and future restoration.
 */
export function archiveStation(d:Data,stationId:string,now=Date.now()):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 if(station.archivedAt)return station;
 if(d.rentals.some(r=>r.stationId===stationId&&OPEN_STATES.includes(r.state)))throw new DomainError('Impossible d’archiver : une location est encore en cours sur cette borne.',409);
 station.archivedAt=now;return station;
}
export function restoreStation(d:Data,stationId:string):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 station.archivedAt=null;return station;
}
/**
 * Moving the physical unit itself to a new venue — a client relationship ending, hardware
 * redeployed elsewhere — not creating a second station for the same hardware. providerDeviceId
 * (the manufacturer's own cabinet id) is untouched: it is still the exact same cabinet. The Stripe
 * Terminal Location is cleared rather than carried over: it names a physical address, and that
 * address just changed — an operator must assign the right one for the new site.
 */
export function relocateStation(d:Data,stationId:string,venueId:string,now=Date.now()):Station {
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
 const venue=d.venues.find(v=>v.id===venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
 if(venue.id===station.venueId&&venue.partnerId===station.partnerId)return station;
 if(d.rentals.some(r=>r.stationId===stationId&&OPEN_STATES.includes(r.state)))throw new DomainError('Impossible de déplacer : une location est encore en cours sur cette borne.',409);
 station.venueId=venue.id;station.partnerId=venue.partnerId;
 station.stripeTerminalLocationId=null;station.stripeTerminalLocationUpdatedAt=now;
 return station;
}
export interface CreateVenueInput {partnerId:string;name:string;city:string;address:string;category:string;hours:string;latitude?:number|null;longitude?:number|null;}
export function createVenue(d:Data,input:CreateVenueInput):Venue {
 if(!input.name.trim()||input.name.length>120)throw new DomainError('Nom d’établissement invalide.',400);
 if(!input.city.trim()||input.city.length>80)throw new DomainError('Ville invalide.',400);
 if(!input.address.trim()||input.address.length>200)throw new DomainError('Adresse invalide.',400);
 if(!d.partners.some(p=>p.id===input.partnerId))throw new DomainError('Partenaire invalide.',404);
 if(input.latitude!=null&&(input.latitude<-90||input.latitude>90))throw new DomainError('Latitude invalide.',400);
 if(input.longitude!=null&&(input.longitude<-180||input.longitude>180))throw new DomainError('Longitude invalide.',400);
 const venue:Venue={id:crypto.randomUUID(),partnerId:input.partnerId,name:input.name.trim(),city:input.city.trim(),address:input.address.trim(),category:input.category.trim()||'Établissement',hours:input.hours.trim()||'Non renseigné',latitude:input.latitude??null,longitude:input.longitude??null};
 d.venues.push(venue);return venue;
}
