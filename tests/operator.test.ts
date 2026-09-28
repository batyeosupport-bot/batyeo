import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOperator} from '../core/operator';

const full={OPERATOR_NAME:'Jean Test',OPERATOR_SIRET:'12345678900012',OPERATOR_ADDRESS:'1 rue de Paris, 75001 Paris',OPERATOR_EMAIL:'contact@example.fr',OPERATOR_MEDIATOR_NAME:'Médiateur X',OPERATOR_MEDIATOR_URL:'https://mediateur.example'};

test('legal mentions are complete only with identity, SIRET, address, contact and mediator', () => {
 assert.equal(resolveOperator(full).complete,true);
 for(const key of Object.keys(full))assert.equal(resolveOperator({...full,[key]:'  '}).complete,false,key);
 assert.equal(resolveOperator({...full,OPERATOR_PHONE:undefined,OPERATOR_LEGAL_FORM:undefined}).complete,true);
});

test('an unconfigured deployment exposes no identity at all', () => {
 const o=resolveOperator({});
 assert.equal(o.complete,false);
 assert.equal(o.name,null);
 assert.equal(o.siret,null);
});
