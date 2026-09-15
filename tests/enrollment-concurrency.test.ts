import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeEnrollmentRegistry} from '../core/enrollment';

test('concurrent token replay enrolls exactly one runtime',async()=>{
 const registry=new RuntimeEnrollmentRegistry();const token=await registry.issue('s','p',1000,0);
 const results=await Promise.allSettled(['a','b'].map(id=>registry.enroll(token.tokenId,token.rawToken,id,'',1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('two tokens cannot concurrently claim the same runtime',async()=>{
 const registry=new RuntimeEnrollmentRegistry();const tokens=await Promise.all([registry.issue('s','p',1000,0),registry.issue('other','other-partner',1000,0)]);
 const results=await Promise.allSettled(tokens.map(t=>registry.enroll(t.tokenId,t.rawToken,'runtime','',1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('revocation racing authentication and rotation rejects both operations',async()=>{
 const registry=new RuntimeEnrollmentRegistry();const t=await registry.issue('s','p',1000,0);
 const enrolled=await registry.enroll(t.tokenId,t.rawToken,'r','',1);
 const auth=registry.authenticate('r',enrolled.secret,2),rotation=registry.rotate('r',2);
 assert.equal(registry.revoke('r',2),true);
 const results=await Promise.allSettled([auth,rotation]);assert.ok(results.every(r=>r.status==='rejected'));
 assert.equal(registry.revoke('r',3),false);
});
test('concurrent rotations produce only one valid new credential',async()=>{
 const registry=new RuntimeEnrollmentRegistry();const t=await registry.issue('s','p',1000,0);
 await registry.enroll(t.tokenId,t.rawToken,'r','',1);
 const results=await Promise.allSettled([registry.rotate('r',2),registry.rotate('r',2)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const success=results.find(r=>r.status==='fulfilled');assert.ok(success&&success.status==='fulfilled');
 assert.equal((await registry.authenticate('r',success.value.secret,3)).version,2);
});
test('returned records cannot unconsume tokens or revoke registry credentials',async()=>{
 const registry=new RuntimeEnrollmentRegistry();const t=await registry.issue('s','p',1000,0);
 const enrolled=await registry.enroll(t.tokenId,t.rawToken,'r','',1);
 t.token.usedAt=null;t.token.expiresAt=99999;enrolled.credential.revokedAt=0;
 await assert.rejects(()=>registry.enroll(t.tokenId,t.rawToken,'other','',2));
 assert.equal((await registry.authenticate('r',enrolled.secret,2)).revokedAt,null);
});
test('expired tokens and unbounded lifetimes are rejected',async()=>{
 const registry=new RuntimeEnrollmentRegistry();
 for(const ttl of [NaN,Infinity,0,600001])await assert.rejects(()=>registry.issue('s','p',ttl,0));
 const t=await registry.issue('s','p',10,0);await assert.rejects(()=>registry.enroll(t.tokenId,t.rawToken,'r','',10));
});
