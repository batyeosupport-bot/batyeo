import test from 'node:test';
import assert from 'node:assert/strict';
import {detectProviderContractDrift} from '../core/manufacturer';
test('provider contract drift reports additive fields without failing sync',()=>{const drift=detectProviderContractDrift({code:0,data:{online:true}},{code:0,data:{online:true,newField:'observed'}});assert.equal(drift.length,1);assert.equal(drift[0].kind,'ADDED_FIELD');assert.equal(drift[0].critical,false);});
test('provider contract drift marks type changes critical',()=>{const drift=detectProviderContractDrift({code:0},{code:'0'});assert.equal(drift[0].kind,'TYPE_CHANGED');assert.equal(drift[0].critical,true);});
