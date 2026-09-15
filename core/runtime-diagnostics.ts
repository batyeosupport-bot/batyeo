const SECRET_KEY = /(secret|password|token|authorization|credential|api[-_]?key|cookie|card|payment)/i;

export interface RuntimeDiagnostics {
  runtimeId: string;
  stationId: string;
  runtimeVersion: string;
  configVersion: number | null;
  connectivity: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  coreStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  providerStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  lastSyncAt: number | null;
  heartbeatAt: number | null;
  capabilities: Record<string, string>;
  notes?: string[];
}

/** Return only the bounded, operator-safe fields allowed on a diagnostics screen/log. */
export function sanitizeRuntimeDiagnostics(input: RuntimeDiagnostics): RuntimeDiagnostics {
  const safeCapabilities: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.capabilities)) {
    if (!SECRET_KEY.test(key)) safeCapabilities[key.slice(0, 80)] = String(value).slice(0, 80);
  }
  return {
    runtimeId: input.runtimeId.slice(0, 120),
    stationId: input.stationId.slice(0, 120),
    runtimeVersion: input.runtimeVersion.slice(0, 40),
    configVersion: input.configVersion,
    connectivity: input.connectivity,
    coreStatus: input.coreStatus,
    providerStatus: input.providerStatus,
    lastSyncAt: input.lastSyncAt,
    heartbeatAt: input.heartbeatAt,
    capabilities: safeCapabilities,
    notes: input.notes?.map((note) => note.slice(0, 200)).slice(0, 20),
  };
}
