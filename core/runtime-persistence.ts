import type {HardwareDiscoveryRecord, RuntimeCredentialRecord, StationCapabilityRecord} from './types';
import type {Repository} from './repository';

export async function upsertRuntimeCredential(repository: Repository, credential: RuntimeCredentialRecord) {
  return repository.transaction((data) => {
    const existing = data.runtimeCredentials.find((row) => row.runtimeId === credential.runtimeId);
    if (existing && existing.id !== credential.id) throw new Error('Runtime already enrolled.');
    const index = data.runtimeCredentials.findIndex((row) => row.id === credential.id);
    if (index >= 0) {
      const current=data.runtimeCredentials[index];
      if(current.runtimeId!==credential.runtimeId||current.stationId!==credential.stationId||current.partnerId!==credential.partnerId)throw new Error('Runtime identity is immutable.');
      if(current.revokedAt!==null&&credential.revokedAt!==current.revokedAt)throw new Error('Revoked credential cannot be restored by upsert.');
      if(credential.version<current.version)throw new Error('Stale credential version.');
      if(credential.digest!==current.digest&&credential.version!==current.version+1)throw new Error('Credential rotation requires next version.');
      data.runtimeCredentials[index] = structuredClone(credential);
    }else data.runtimeCredentials.push(structuredClone(credential));
    return structuredClone(credential);
  });
}
export async function revokeRuntimeCredential(repository: Repository, runtimeId: string, at = Date.now()) {
  return repository.transaction((data) => { const credential = data.runtimeCredentials.find((row) => row.runtimeId === runtimeId && row.revokedAt === null); if (!credential) return false; credential.revokedAt = at; return true; });
}
export async function recordHardwareDiscovery(repository: Repository, report: HardwareDiscoveryRecord) { return repository.transaction((data) => { data.hardwareDiscoveryReports.push(report); return report; }); }
export async function upsertStationCapability(repository: Repository, capability: StationCapabilityRecord) { return repository.transaction((data) => { const index = data.stationCapabilities.findIndex((row) => row.stationId === capability.stationId && row.capability === capability.capability); if (index >= 0) data.stationCapabilities[index] = capability; else data.stationCapabilities.push(capability); return capability; }); }
