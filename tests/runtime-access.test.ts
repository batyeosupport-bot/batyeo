import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeRuntime} from '../core/runtime-access';
const principal={runtimeId:'runtime-1',stationId:'station-1',partnerId:'partner-1',version:1,revokedAt:null};
test('runtime access is station scoped and allowlisted',()=>{assert.equal(authorizeRuntime(principal,'heartbeat/write','station-1').runtimeId,'runtime-1');assert.throws(()=>authorizeRuntime(principal,'heartbeat/write','station-2'));assert.throws(()=>authorizeRuntime(principal,'admin/read','station-1'));});
test('revoked runtime cannot access diagnostics',()=>{assert.throws(()=>authorizeRuntime({...principal,revokedAt:10},'diagnostics/read','station-1'));});
