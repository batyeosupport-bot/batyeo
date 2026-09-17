import {z} from 'zod';
import {validatePlaylist, type Playlist} from './media';
import {validateTranslations} from './i18n';
import type {StationDisplayConfig} from './station-runtime';

export interface RuntimeConfigEnvelope {
  config: StationDisplayConfig;
  checksum: string;
  issuedAt: number;
}

export type RuntimeConfigDecision =
  | {status: 'APPLIED'; config: StationDisplayConfig; reason: 'NEWER_VERSION' | 'INITIAL'}
  | {status: 'IGNORED'; config: StationDisplayConfig | null; reason: 'STALE_VERSION' | 'INVALID_CHECKSUM' | 'INVALID_CONFIG'}
  | {status: 'ROLLED_BACK'; config: StationDisplayConfig; reason: 'INVALID_CONFIG'};

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

/** Deterministic non-secret checksum used to detect corrupted/partial config payloads. */
export function checksumConfig(config: StationDisplayConfig): string {
  const input = stable(config);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const configSchema=z.object({version:z.number().int().nonnegative(),venueName:z.string().trim().min(1),locale:z.string().min(1),idleContent:z.string(),supportContact:z.string(),maintenanceBanner:z.string().nullable(),refreshIntervalMs:z.number().int().min(5000),featureFlags:z.record(z.boolean()),advertisingSlots:z.array(z.string())});
export function validateRuntimeConfig(config: StationDisplayConfig): StationDisplayConfig {
  configSchema.parse(config);
  if (!Number.isInteger(config.version) || config.version < 0) throw new Error('Invalid runtime config version.');
  if (!config.venueName || !config.locale || config.refreshIntervalMs < 5_000) throw new Error('Invalid runtime config metadata.');
  if (config.playlist) validatePlaylist(config.playlist as Playlist);
  if (config.translations) validateTranslations(config.translations);
  return config;
}

export function applyRuntimeConfig(
  current: StationDisplayConfig | null,
  lastKnownGood: StationDisplayConfig | null,
  envelope: RuntimeConfigEnvelope,
): RuntimeConfigDecision {
  if (checksumConfig(envelope.config) !== envelope.checksum) {
    return current
      ? {status: 'IGNORED', config: current, reason: 'INVALID_CHECKSUM'}
      : lastKnownGood
        ? {status: 'ROLLED_BACK', config: lastKnownGood, reason: 'INVALID_CONFIG'}
        : {status: 'IGNORED', config: null, reason: 'INVALID_CHECKSUM'};
  }
  try { validateRuntimeConfig(envelope.config); } catch {
    if (lastKnownGood) return {status: 'ROLLED_BACK', config: lastKnownGood, reason: 'INVALID_CONFIG'};
    return {status: 'IGNORED', config: current, reason: 'INVALID_CONFIG'};
  }
  if (current && envelope.config.version <= current.version) return {status: 'IGNORED', config: current, reason: 'STALE_VERSION'};
  return {status: 'APPLIED', config: envelope.config, reason: current ? 'NEWER_VERSION' : 'INITIAL'};
}
