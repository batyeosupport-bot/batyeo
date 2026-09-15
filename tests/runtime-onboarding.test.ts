import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRuntimeOnboarding} from '../core/runtime-onboarding';
const base={stationId:'station-1',runtimeEnrolled:true,coreHealthy:true,configLoaded:true,heartbeat:'ONLINE' as const,providerHealth:'HEALTHY' as const,providerMapped:true,slotsReadable:true,batteriesReadable:true,availabilityReadable:true,openCriticalReconciliations:0};
test('runtime onboarding is ready only with healthy evidence',()=>{assert.equal(assessRuntimeOnboarding(base).status,'READY');assert.equal(assessRuntimeOnboarding({...base,heartbeat:'UNKNOWN'}).status,'PARTIALLY_READY');});
test('critical runtime/provider conditions fail closed',()=>{const result=assessRuntimeOnboarding({...base,providerHealth:'DOWN',openCriticalReconciliations:1});assert.equal(result.status,'BLOCKED');assert.deepEqual(result.blockingReasons,['provider-down','critical-reconciliation']);});
