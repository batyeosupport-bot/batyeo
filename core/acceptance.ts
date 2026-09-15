export type AcceptanceStatus='PASS'|'FAIL'|'NOT_SUPPORTED'|'NOT_VERIFIED';
export type AcceptanceCheck='CORE_CONNECTIVITY'|'RUNTIME_AUTH'|'REMOTE_CONFIG'|'OFFLINE_CACHE'|'HEARTBEAT'|'DISPLAY'|'TOUCH'|'QR_DISPLAY'|'PROVIDER_MAPPING'|'PROVIDER_READ_ONLY'|'SLOTS_READ'|'BATTERIES_READ'|'AVAILABILITY_READ'|'RECONCILIATION'|'RUNTIME_REBOOT_RECOVERY';
export interface AcceptanceResult {stationId:string;checkedAt:number;checks:Record<AcceptanceCheck,AcceptanceStatus>;notes:Record<string,string>;}
export function acceptanceStatus(checks:Partial<Record<AcceptanceCheck,AcceptanceStatus>>):'PASS'|'PARTIALLY_READY'|'BLOCKED'{const values=Object.values(checks);return values.includes('FAIL')?'BLOCKED':values.includes('NOT_VERIFIED')?'PARTIALLY_READY':'PASS';}
