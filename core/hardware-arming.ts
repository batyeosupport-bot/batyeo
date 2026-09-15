import {DomainError} from './providers';
export type PhysicalActionType='EJECT_BATTERY'|'EJECT_SPECIFIC_SLOT'|'RETURN_CONFIRMATION';
export interface HardwareActionAuthorization {id:string;stationId:string;actionType:PhysicalActionType;authorizedBy:string;authorizedAt:number;expiresAt:number;singleUse:boolean;environment:string;consumedAt:number|null;}
export class HardwareArmingRegistry {
 private readonly entries=new Map<string,HardwareActionAuthorization>();
 issue(stationId:string,actionType:PhysicalActionType,authorizedBy:string,environment:string,ttlMs=5*60_000,now=Date.now()){if(environment!=='staging'||ttlMs<=0)throw new DomainError('Physical authorization is staging-only.',403);const entry={id:crypto.randomUUID(),stationId,actionType,authorizedBy,authorizedAt:now,expiresAt:now+ttlMs,singleUse:true,environment,consumedAt:null};this.entries.set(entry.id,entry);return entry;}
 consume(id:string,stationId:string,actionType:PhysicalActionType,environment:string,now=Date.now()){const e=this.entries.get(id);if(!e||e.consumedAt!==null||e.expiresAt<=now||e.stationId!==stationId||e.actionType!==actionType||e.environment!==environment)throw new DomainError('Physical authorization invalid, expired or already consumed.',403);e.consumedAt=now;return {...e};}
}
