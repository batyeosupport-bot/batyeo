import type {AcceptanceCheck, AcceptanceStatus} from './acceptance';
import {acceptanceStatus} from './acceptance';
import type {ProviderHealth} from './types';
import type {RuntimeHealth} from './heartbeat';

export interface RuntimeOnboardingInput {stationId:string;runtimeEnrolled:boolean;coreHealthy:boolean;configLoaded:boolean;heartbeat:RuntimeHealth;providerHealth:ProviderHealth;providerMapped:boolean;slotsReadable:boolean;batteriesReadable:boolean;availabilityReadable:boolean;openCriticalReconciliations:number;}
export interface RuntimeOnboardingResult {stationId:string;status:'READY'|'PARTIALLY_READY'|'BLOCKED';checks:Partial<Record<AcceptanceCheck,AcceptanceStatus>>;blockingReasons:string[];}
export function assessRuntimeOnboarding(input:RuntimeOnboardingInput):RuntimeOnboardingResult {
 const checks:Partial<Record<AcceptanceCheck,AcceptanceStatus>>={CORE_CONNECTIVITY:input.coreHealthy?'PASS':'FAIL',RUNTIME_AUTH:input.runtimeEnrolled?'PASS':'NOT_VERIFIED',REMOTE_CONFIG:input.configLoaded?'PASS':'FAIL',HEARTBEAT:input.heartbeat==='ONLINE'?'PASS':input.heartbeat==='UNKNOWN'?'NOT_VERIFIED':'FAIL',PROVIDER_MAPPING:input.providerMapped?'PASS':'NOT_VERIFIED',PROVIDER_READ_ONLY:input.providerHealth==='HEALTHY'?'PASS':input.providerHealth==='UNKNOWN'?'NOT_VERIFIED':'FAIL',SLOTS_READ:input.slotsReadable?'PASS':'NOT_VERIFIED',BATTERIES_READ:input.batteriesReadable?'PASS':'NOT_VERIFIED',AVAILABILITY_READ:input.availabilityReadable?'PASS':'NOT_VERIFIED',RECONCILIATION:input.openCriticalReconciliations===0?'PASS':'FAIL'};
 const blockingReasons:string[]=[];if(!input.coreHealthy)blockingReasons.push('core-unhealthy');if(!input.configLoaded)blockingReasons.push('config-unavailable');if(input.heartbeat==='OFFLINE')blockingReasons.push('runtime-offline');if(input.providerHealth==='DOWN')blockingReasons.push('provider-down');if(input.openCriticalReconciliations>0)blockingReasons.push('critical-reconciliation');
 const aggregate=acceptanceStatus(checks); return {stationId:input.stationId,status:blockingReasons.length?'BLOCKED':aggregate==='PASS'?'READY':aggregate,checks,blockingReasons};
}
