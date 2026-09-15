import test from 'node:test';
import assert from 'node:assert/strict';
import {MobileClient,stationIdFromLink,validateCoreUrl} from '../mobile/client';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('Mobile QR only accepts the configured origin and station scheme',()=>{
 const origin='https://batyeo.test/api/core';
 assert.equal(stationIdFromLink('https://batyeo.test/rent/paris-demo',origin),'paris-demo');
 assert.equal(stationIdFromLink('https://evil.test/rent/paris-demo',origin),null);
 assert.equal(stationIdFromLink('batyeo://rent/paris-demo',origin),'paris-demo');
 assert.equal(stationIdFromLink('https://batyeo.test/rent/paris-demo?price=1',origin),null);
 assert.throws(()=>validateCoreUrl('https://secret:password@batyeo.test/api'));
});
test('Mobile session recovery reuses secure token without creating a new session',async()=>{
 const paths:string[]=[];const client=new MobileClient('https://batyeo.test',{get:async()=>'saved',set:async()=>{throw Error('Unexpected write');}},()=> 'key',async(url,init)=>{paths.push(String(url));assert.equal(new Headers(init?.headers).get('x-batyeo-customer-token'),'saved');return json({rental:{id:'same'},serverTime:0});});
 assert.equal((await client.current()).rental?.id,'same');assert.equal(paths.length,1);
});
test('Mobile duplicate start shares the mutation; uncertain retry keeps idempotency key',async()=>{
 let attempt=0;const keys:string[]=[];
 const client=new MobileClient('https://batyeo.test',{get:async()=>'saved',set:async()=>{}},()=> 'stable',async(url,init)=>{if(String(url).endsWith('/customer'))return json({rental:null});keys.push(JSON.parse(String(init?.body)).idempotencyKey);attempt++;if(attempt===1)throw Error('Network interrupted');return json({rental:{id:'one'}});});
 const first=client.action('start','paris-demo'),second=client.action('start','paris-demo');assert.equal(first,second);await assert.rejects(first,/Connexion/);await client.action('start','paris-demo');assert.deepEqual(keys,['stable','stable']);
});
test('Mobile recovered active rental prevents a second start; completed return retry is read-only',async()=>{
 let state='ACTIVE';let writes=0;const client=new MobileClient('https://batyeo.test',{get:async()=>'saved',set:async()=>{}},()=> 'key',async(_url,init)=>{if(init?.method==='POST')writes++;return json({rental:{id:'same',state}});});
 assert.equal((await client.action('start','paris-demo')).rental.id,'same');state='COMPLETED';assert.equal((await client.action('customer/return','lyon-demo')).rental.id,'same');assert.equal(writes,0);
});
test('Mobile rejects a login HTML response and expired session without silently resetting it',async()=>{
 const storage={get:async()=>'expired',set:async()=>{throw Error('Must not erase session');}};
 const html=new MobileClient('https://batyeo.test',storage,()=>'',async()=>new Response('<html>Login</html>'));await assert.rejects(html.current(),/API inaccessible/);
 const expired=new MobileClient('https://batyeo.test',storage,()=>'',async()=>json({error:'Session expirée'},401));await assert.rejects(expired.current(),/Session expirée/);
});
