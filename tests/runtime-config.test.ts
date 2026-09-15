import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRuntimeConfig, checksumConfig} from '../core/runtime-config';
import type {StationDisplayConfig} from '../core/station-runtime';
import {sanitizeRuntimeDiagnostics} from '../core/runtime-diagnostics';

const config = (version: number): StationDisplayConfig => ({version, venueName: 'Demo', locale: 'fr-FR', idleContent: 'BATYEO', supportContact: 'support@example.test', maintenanceBanner: null, refreshIntervalMs: 10_000, featureFlags: {}, advertisingSlots: []});

test('runtime config applies newer checksum-valid versions and ignores stale', () => {
  const first = config(1);
  const applied = applyRuntimeConfig(null, null, {config: first, checksum: checksumConfig(first), issuedAt: Date.now()});
  assert.equal(applied.status, 'APPLIED');
  const stale = applyRuntimeConfig(first, first, {config: first, checksum: checksumConfig(first), issuedAt: Date.now()});
  assert.deepEqual(stale, {status: 'IGNORED', config: first, reason: 'STALE_VERSION'});
});

test('invalid runtime config rolls back to last-known-good', () => {
  const good = config(2);
  const bad = {...config(3), venueName: ''};
  const result = applyRuntimeConfig(good, good, {config: bad, checksum: checksumConfig(bad), issuedAt: Date.now()});
  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(result.config?.version, 2);
});

test('diagnostics projection removes secret-like capabilities', () => {
  const safe = sanitizeRuntimeDiagnostics({runtimeId: 'runtime-1', stationId: 'station-1', runtimeVersion: '1.0.0', configVersion: 2, connectivity: 'ONLINE', coreStatus: 'HEALTHY', providerStatus: 'UNKNOWN', lastSyncAt: null, heartbeatAt: null, capabilities: {TOUCH: 'SUPPORTED', apiToken: 'never-return-this'}});
  assert.equal(safe.capabilities.TOUCH, 'SUPPORTED');
  assert.equal(Object.keys(safe.capabilities).includes('apiToken'), false);
});

test('invalid initial config is never returned as usable fallback',()=>{
 const bad={...config(1),refreshIntervalMs:NaN};
 const decision=applyRuntimeConfig(null,null,{config:bad,checksum:checksumConfig(bad),issuedAt:1});
 assert.equal(decision.status,'IGNORED');assert.equal(decision.config,null);
 const corrupted=applyRuntimeConfig(null,null,{config:config(1),checksum:'broken',issuedAt:1});
 assert.equal(corrupted.config,null);
});
