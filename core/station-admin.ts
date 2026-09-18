import type {Data,Station,Venue} from './types';
import {DomainError} from './providers';
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
