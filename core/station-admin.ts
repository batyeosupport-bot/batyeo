import type {Battery,Data,Partner,Station,User,Venue} from './types';
import {DomainError} from './providers';
import {OPEN_STATES} from './rental';
export interface CreatePartnerInput {name:string;city:string;adminEmail:string;adminName:string;}
/**
 * Onboards a brand-new tenant: the Partner row and its first PARTNER_ADMIN login, in one step —
 * a partner with no user attached is a dead end nobody can ever sign into. commissionBps starts
 * at null (follows the pricing grid); a SUPER_ADMIN/ADMIN/FINANCE role can set a fixed rate
 * afterward from the Partners table (setPartnerCommission), same as for any existing partner.
 * passwordHash is computed by the caller (async, outside this synchronous mutation) and is the
 * hash of a one-time temporary secret the caller shows once and never stores in plaintext.
 */
export function createPartner(d:Data,input:CreatePartnerInput,passwordHash:string):{partner:Partner;user:User} {
 if(!input.name.trim()||input.name.length>120)throw new DomainError('Nom de partenaire invalide.',400);
 if(!input.city.trim()||input.city.length>80)throw new DomainError('Ville invalide.',400);
 if(!input.adminName.trim()||input.adminName.length>80)throw new DomainError('Nom du contact invalide.',400);
 const email=input.adminEmail.trim().toLowerCase();
 if(!email)throw new DomainError('Email du contact invalide.',400);
 if(d.users.some(u=>u.email.toLowerCase()===email))throw new DomainError('Cet email est déjà utilisé.',409);
 const partner:Partner={id:crypto.randomUUID(),name:input.name.trim(),city:input.city.trim(),commissionBps:null};
 d.partners.push(partner);
 const user:User={id:crypto.randomUUID(),email,name:input.adminName.trim(),role:'PARTNER_ADMIN',partnerId:partner.id,passwordHash,authVersion:0};
 d.users.push(user);
 d.partnerUsers.push({id:crypto.randomUUID(),userId:user.id,partnerId:partner.id});
 return {partner,user};
}
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
/**
 * Taux de commission propre à un partenaire ; `null` le remet sur celui de la grille tarifaire.
 * N'affecte que les locations créées ensuite : le taux est figé dans le snapshot de chaque
 * location au moment de sa création (voir pricingForPartner), jamais relu à la restitution.
 */
export function setPartnerCommission(d:Data,partnerId:string,commissionBps:number|null):Partner {
 const partner=d.partners.find(p=>p.id===partnerId);if(!partner)throw new DomainError('Partenaire introuvable.',404);
 if(commissionBps!==null&&(!Number.isSafeInteger(commissionBps)||commissionBps<0||commissionBps>10_000))throw new DomainError('Taux de commission invalide.',400);
 partner.commissionBps=commissionBps;return partner;
}
export interface VenueFields {name:string;city:string;address:string;category:string;hours:string;latitude?:number|null;longitude?:number|null;phone?:string;}
export interface CreateVenueInput extends VenueFields {partnerId:string;}
/** Mêmes règles à la création et à la correction : une fiche valide ne doit pas dépendre de la porte par laquelle elle est entrée. */
function venueFields(input:VenueFields):Omit<Venue,'id'|'partnerId'> {
 if(!input.name.trim()||input.name.length>120)throw new DomainError('Nom d’établissement invalide.',400);
 if(!input.city.trim()||input.city.length>80)throw new DomainError('Ville invalide.',400);
 if(!input.address.trim()||input.address.length>200)throw new DomainError('Adresse invalide.',400);
 if(input.latitude!=null&&(input.latitude<-90||input.latitude>90))throw new DomainError('Latitude invalide.',400);
 if(input.longitude!=null&&(input.longitude<-180||input.longitude>180))throw new DomainError('Longitude invalide.',400);
 if(input.phone!==undefined&&input.phone.length>30)throw new DomainError('Téléphone invalide.',400);
 return {name:input.name.trim(),city:input.city.trim(),address:input.address.trim(),category:input.category.trim()||'Établissement',hours:input.hours.trim()||'Non renseigné',latitude:input.latitude??null,longitude:input.longitude??null,...(input.phone!==undefined?{phone:input.phone.trim()}:{})};
}
export function createVenue(d:Data,input:CreateVenueInput):Venue {
 const fields=venueFields(input);
 if(!d.partners.some(p=>p.id===input.partnerId))throw new DomainError('Partenaire invalide.',404);
 const venue:Venue={id:crypto.randomUUID(),partnerId:input.partnerId,...fields};
 d.venues.push(venue);return venue;
}
/**
 * Corrige la fiche d’un établissement. Le partenaire n’est pas modifiable ici : changer de
 * partenaire est un transfert commercial, qui passe borne par borne par relocateStation.
 * Si l’adresse ou la ville change, la Location Stripe des bornes du lieu est effacée, pour la
 * raison qui vaut déjà dans relocateStation : une Location nomme une adresse physique, et ce
 * n’est plus la bonne. Un opérateur doit en réassigner une, plutôt que de laisser un lecteur
 * de carte rattaché en silence à l’ancienne.
 */
export function updateVenue(d:Data,venueId:string,input:VenueFields,now=Date.now()):Venue {
 const venue=d.venues.find(v=>v.id===venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
 const fields=venueFields(input);
 const moved=fields.address!==venue.address||fields.city!==venue.city;
 Object.assign(venue,fields);
 if(moved)for(const s of d.stations.filter(s=>s.venueId===venue.id&&s.stripeTerminalLocationId)){s.stripeTerminalLocationId=null;s.stripeTerminalLocationUpdatedAt=now;}
 return venue;
}

export const INVENTORY_SNAPSHOT_MAX_AGE_MS=10*60_000;
export interface MirrorResult {changed:boolean;skipped?:string;added:number;moved:number;missing:number}
/**
 * Makes BATYEO's slots and batteries say exactly what the cabinet's last read says is physically
 * inside it. A real ejection names a manufacturer battery id and the coordinator requires that id
 * to sit AVAILABLE in a local slot, and the count shown on the screen is the local one capped by
 * the cabinet: both are only right if the local map follows the hardware. Runs after every
 * successful read (automatic) and behind « Aligner l'inventaire » (strict: says why it cannot).
 *
 * Never deletes a row — batteries and slots are durable, past rentals point at them. A battery
 * that left the cabinet without a BATYEO rental becomes MISSING; one that comes back, or a LOST one
 * a customer brings back, returns to service. Stands aside while a rental is starting or a return
 * is still being processed: those flows own the battery at that moment, and the next read retries.
 * Charge is not known (the supplier only gives a voltage with no documented conversion), so a new
 * battery is stored at 100 to avoid false low-battery alerts.
 */
export function mirrorCabinetInventory(d:Data,stationId:string,now=Date.now(),strict=false):MirrorResult{
 const none={changed:false,added:0,moved:0,missing:0};
 const stop=(reason:string,status=409):MirrorResult=>{if(strict)throw new DomainError(reason,status);return {...none,skipped:reason};};
 const station=d.stations.find(s=>s.id===stationId);if(!station)return stop('Station introuvable.',404);
 const link=d.stationProviderLinks.find(l=>l.stationId===stationId&&l.active);if(!link)return stop('Cette station n’est associée à aucune borne fabricant.');
 const snapshot=d.stationProviderSnapshots.find(s=>s.linkId===link.id);
 if(!snapshot||snapshot.syncedAt<now-INVENTORY_SNAPSHOT_MAX_AGE_MS)return stop('Aucune lecture récente de la borne : lancez d’abord une synchronisation fabricant.');
 if(!snapshot.online)return stop('La borne est hors ligne : impossible de connaître son contenu réel.');
 if(d.rentals.some(r=>r.stationId===stationId&&['CREATED','PAYMENT_AUTH','EJECTING'].includes(r.state)))return stop('Une location démarre à cette borne.');
 if(snapshot.slots.some(s=>!Number.isInteger(s.position)||s.position<1||s.position>snapshot.totalSlots))return stop('Positions de slot incohérentes côté fabricant.');
 const incoming=snapshot.slots.flatMap(s=>s.batteryId?[s.batteryId]:[]);
 if(new Set(incoming).size!==incoming.length)return stop('La borne annonce deux fois la même batterie.');
 if(incoming.some(id=>d.batteries.find(b=>b.id===id)?.status==='RENTED'))return stop('Un retour de batterie est en cours de traitement.');
 const wanted=new Map(snapshot.slots.flatMap(s=>s.batteryId?[[s.position,s.batteryId] as const]:[])),present=new Set(incoming);
 if(snapshot.totalSlots>station.capacity)station.capacity=snapshot.totalSlots;
 for(let position=1;position<=snapshot.totalSlots;position++)if(!d.slots.some(s=>s.stationId===stationId&&s.position===position))d.slots.push({id:crypto.randomUUID(),stationId,position,batteryId:null});
 const result={...none};
 for(const slot of d.slots.filter(s=>s.stationId===stationId)){
  if(!slot.batteryId||wanted.get(slot.position)===slot.batteryId)continue;
  const battery=d.batteries.find(b=>b.id===slot.batteryId);slot.batteryId=null;
  if(battery&&!present.has(battery.id)){battery.status='MISSING';result.missing++;}
 }
 for(const [position,batteryId] of wanted){
  const slot=d.slots.find(s=>s.stationId===stationId&&s.position===position)!;if(slot.batteryId===batteryId)continue;
  for(const other of d.slots)if(other.batteryId===batteryId)other.batteryId=null;
  const battery=d.batteries.find(b=>b.id===batteryId);
  if(!battery){d.batteries.push({id:batteryId,charge:100,status:'AVAILABLE'});result.added++;}
  else{if(battery.status==='MISSING'||battery.status==='LOST')battery.status='AVAILABLE';result.moved++;}
  slot.batteryId=batteryId;
 }
 return {...result,changed:result.added+result.moved+result.missing>0};
}
/** « Aligner l'inventaire » : the same mirror, on demand, and refusing out loud instead of waiting for the next read. */
export function adoptProviderInventory(d:Data,stationId:string,now=Date.now()):{batteries:number;slots:number} {
 const result=mirrorCabinetInventory(d,stationId,now,true);void result;
 const snapshot=d.stationProviderSnapshots.find(s=>s.stationId===stationId)!;
 return {batteries:snapshot.slots.filter(s=>s.batteryId).length,slots:snapshot.totalSlots};
}

/**
 * Puts a battery back into — or out of — service. Without this, MAINTENANCE and the recovery of a
 * LOST battery are only reachable from the demo simulator, which production refuses: a battery
 * whose deposit was captured at the 48 h mark and that the customer then brings back stays LOST
 * for ever, and a physically damaged battery cannot be pulled from rotation. Never touches a
 * battery a customer is still holding. A LOST battery sits in no slot (the invariant forbids it),
 * so putting it back in service needs the station where it was found.
 */
export function setBatteryService(d:Data,batteryId:string,action:'MAINTENANCE'|'AVAILABLE',stationId?:string):Battery {
 const battery=d.batteries.find(b=>b.id===batteryId);if(!battery)throw new DomainError('Batterie introuvable.',404);
 if(battery.status==='RENTED')throw new DomainError('Cette batterie est en location : attendez son retour.',409);
 if(action==='MAINTENANCE'){
  if(battery.status==='LOST')throw new DomainError('Cette batterie est enregistrée comme perdue : remettez-la d’abord en service.',409);
  battery.status='MAINTENANCE';return battery;
 }
 if(battery.status!=='LOST'){battery.status='AVAILABLE';return battery;}
 const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Indiquez la station où la batterie a été retrouvée.',400);
 const slot=d.slots.find(s=>s.stationId===station.id&&!s.batteryId);if(!slot)throw new DomainError('Aucun emplacement libre dans cette station.',409);
 slot.batteryId=battery.id;battery.status='AVAILABLE';return battery;
}
