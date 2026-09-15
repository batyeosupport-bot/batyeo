
export const RUNTIME_ENDPOINTS=['config/read','heartbeat/write','station/read','provider/status','diagnostics/read'] as const;
export type RuntimeEndpoint=typeof RUNTIME_ENDPOINTS[number];
export interface RuntimePrincipal {runtimeId:string;stationId:string;partnerId:string;version:number;revokedAt:number|null;}
export function authorizeRuntime(principal:RuntimePrincipal|undefined, endpoint:string, stationId:string):RuntimePrincipal {
  if(!principal||principal.revokedAt!==null) throw new Error('Runtime credential rejected.');
  if(!RUNTIME_ENDPOINTS.includes(endpoint as RuntimeEndpoint)) throw new Error('Runtime endpoint not permitted.');
  if(principal.stationId!==stationId) throw new Error('Runtime station scope rejected.');
  return principal;
}
