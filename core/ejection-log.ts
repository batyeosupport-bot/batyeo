import type {Data,StationProviderLink} from './types';

/**
 * Contract only — no manufacturer log-read endpoint is confirmed (docs/EXTERNAL_BLOCKERS.md).
 * The admin web panel's own "Pop-up Log" shows exactly this shape (PID, cabinet, slot, battery,
 * operator, timestamp) for every pop operation, whatever triggered it. Nothing calls this
 * interface until an equivalent is confirmed reachable from the Open API — see
 * AsyncBatteryEjector in core/stripe-coordinator.ts for the same not-implemented-yet pattern.
 */
export interface EjectionLogEntry {pid:string;stationExternalId:string;slot:number;batteryId:string;operator:string;operatedAt:number;}
export interface EjectionLogReader {readRecentEjections(stationExternalId:string,sinceMs:number):Promise<EjectionLogEntry[]>;}

export interface SuggestedEjectionMatch {rentalId:string;stationId:string;batteryId:string;pid:string;operatedAt:number;}

/**
 * Pure suggestion, never applied automatically. Only resolveEjectionConfirmed()/resolveEjectionFailed()
 * (docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md) actually move a rental out of physicalState UNKNOWN —
 * an operator, or a future automated step once the log source is confirmed, still decides. This
 * only removes the guessing: given the manufacturer's own ejection log, name which entry most
 * plausibly explains each uncertain rental at that station, oldest uncertain rental first, so an
 * operator reviewing docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md has a candidate battery id instead of
 * having to read the station by hand. Each log entry (identified by its PID) is offered to at most
 * one rental, so two uncertain rentals at the same station are never both matched to the same pop.
 */
export function suggestEjectionMatches(d:Data,link:StationProviderLink,entries:EjectionLogEntry[]):SuggestedEjectionMatch[]{
 const pending=d.rentals.filter(r=>r.stationId===link.stationId&&r.physicalState==='UNKNOWN').sort((a,b)=>a.createdAt-b.createdAt);
 const ownEntries=entries.filter(e=>e.stationExternalId===link.externalId).sort((a,b)=>a.operatedAt-b.operatedAt);
 const usedPids=new Set<string>();
 const matches:SuggestedEjectionMatch[]=[];
 for(const rental of pending){
  const ejectingAt=d.events.find(e=>e.rentalId===rental.id&&e.type==='EJECTING')?.at??rental.createdAt;
  const candidate=ownEntries.find(e=>!usedPids.has(e.pid)&&e.operatedAt>=ejectingAt);
  if(!candidate)continue;
  usedPids.add(candidate.pid);
  matches.push({rentalId:rental.id,stationId:rental.stationId,batteryId:candidate.batteryId,pid:candidate.pid,operatedAt:candidate.operatedAt});
 }
 return matches;
}
