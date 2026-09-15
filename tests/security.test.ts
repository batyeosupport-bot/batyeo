import test from 'node:test';
import assert from 'node:assert/strict';
import {createPasswordHash,verifyPassword,sha256,actorForDigest,cookie,setCookie,requireCustomer} from '../core/security';
import {seedData} from '../core/seed';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';
import {validateData} from '../core/invariants';
class MemoryRepository implements Repository {
 beforeWrite?:()=>void;
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){this.beforeWrite?.();this.beforeWrite=undefined;const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body?:unknown,token?:string){const request=new Request(origin+'/api/core/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:token?`batyeo_session=${token}`:''},body:body===undefined?undefined:JSON.stringify(body)});return createApi(repo,{demo:true,allowLegacyCredentials:true})[body===undefined?'GET':'POST'](request,{params:Promise.resolve({path:path.split('/')})});}
async function authenticated(role='SUPER_ADMIN'){
 const data=seedData('unused');const u=data.users.find(u=>u.role===role)!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);data.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+100000,authVersion:0});return {repo:new MemoryRepository(data),token,digest,u};
}
test('Password hashes are independently salted, versioned and reject bad credentials',async()=>{const a=await createPasswordHash('long-password-2026'),b=await createPasswordHash('long-password-2026');assert.notEqual(a,b);assert.ok(await verifyPassword('long-password-2026',a));assert.equal(await verifyPassword('wrong',a),false);assert.equal(await verifyPassword('wrong','malformed'),false);});
test('Sessions expire, revoke by version and reject disabled users or missing membership',async()=>{const {repo,digest,u}=await authenticated('PARTNER_ADMIN');assert.ok(actorForDigest(digest,repo.data));u.disabledAt=Date.now();assert.equal(actorForDigest(digest,repo.data),undefined);u.disabledAt=null;u.authVersion=1;assert.equal(actorForDigest(digest,repo.data),undefined);u.authVersion=0;repo.data.partnerUsers=[];assert.equal(actorForDigest(digest,repo.data),undefined);});
test('Role changes between read and write are enforced inside the transaction',async()=>{const {repo,token,u}=await authenticated();repo.beforeWrite=()=>{repo.data.users.find(x=>x.id===u.id)!.role='SUPPORT';};const response=await call(repo,'simulate',{action:'offline',stationId:'station-paris'},token);assert.equal(response.status,403);assert.equal(repo.data.stations[0].online,true);});
test('Revocation racing a write prevents it',async()=>{const {repo,token}=await authenticated();repo.beforeWrite=()=>{repo.data.sessions=[];};const response=await call(repo,'settings',{name:'Unauthorized rename'},token);assert.equal(response.status,401);assert.notEqual(repo.data.users[0].name,'Unauthorized rename');});
test('Tenant membership removal immediately denies reads',async()=>{const {repo,token}=await authenticated('PARTNER_ADMIN');repo.data.partnerUsers=[];assert.equal((await call(repo,'dashboard',undefined,token)).status,401);});
test('Session cookies are secure/HttpOnly and malformed cookie values are ignored',()=>{const request=new Request(origin);const value=setCookie(request,'batyeo_session','x'.repeat(64));assert.match(value,/Secure/);assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Lax/);assert.equal(cookie(new Request(origin,{headers:{cookie:'batyeo_session=short'}}),'batyeo_session'),undefined);});
test('Customer session expiry is enforced on server; no rental is created on GET',async()=>{const repo=new MemoryRepository(seedData('unused'));const count=repo.data.rentals.length;const response=await call(repo,'customer');assert.equal(response.status,200);assert.equal(repo.data.rentals.length,count);assert.equal(repo.data.customerSessions.length,1);repo.data.customerSessions[0].expiresAt=Date.now()-1;assert.throws(()=>requireCustomer(repo.data,repo.data.customerSessions[0].id));});
test('Native customer session is bearer-based and browser origin guard remains strict',async()=>{const repo=new MemoryRepository(seedData('unused'));const api=createApi(repo,{demo:true,allowLegacyCredentials:true});const response=await api.POST(new Request('https://batyeo.test/api/core/customer/session',{method:'POST',headers:{'x-batyeo-client':'mobile','content-type':'application/json'},body:'{}'}),{params:Promise.resolve({path:['customer','session']})});assert.equal(response.status,200);const body=await response.json() as {sessionToken:string};assert.match(body.sessionToken,/^[a-zA-Z0-9-]{32,128}$/);assert.equal((await api.POST(new Request('https://batyeo.test/api/core/customer/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{params:Promise.resolve({path:['customer','session']})})).status,403);});
test('A foreign tenant ticket cannot be resolved',async()=>{const {repo,token}=await authenticated('PARTNER_ADMIN');repo.data.tickets[0].partnerId='partner-b';assert.equal((await call(repo,'resolve-ticket',{id:repo.data.tickets[0].id},token)).status,404);assert.equal(repo.data.tickets[0].status,'OPEN');});
test('Customer support ticket is linked server-side to the rental context',async()=>{const repo=new MemoryRepository(seedData('unused'));const rental=repo.data.rentals[0];const customerToken='c'.repeat(64);const customerId=await sha256(customerToken);rental.customerId=customerId;repo.data.customerSessions.push({id:customerId,expiresAt:Date.now()+100000});const request=new Request('https://batyeo.test/api/core/ticket',{method:'POST',headers:{origin:'https://batyeo.test','content-type':'application/json','x-batyeo-customer-token':customerToken},body:JSON.stringify({email:'customer@test.fr',subject:'Batterie défectueuse',message:'La batterie ne charge plus correctement.',rentalId:rental.id})});const response=await createApi(repo,{demo:true,allowLegacyCredentials:true}).POST(request,{params:Promise.resolve({path:['ticket']})});assert.equal(response.status,201);const ticket=repo.data.tickets.at(-1)!;assert.equal(ticket.rentalId,rental.id);assert.equal(ticket.stationId,rental.stationId);assert.equal(ticket.batteryId,rental.batteryId);});
test('Signed Stripe webhook is persisted once and duplicate delivery is acknowledged',async()=>{const repo=new MemoryRepository(seedData('unused'));const secret='whsec_test';const previous=process.env.STRIPE_WEBHOOK_SECRET;process.env.STRIPE_WEBHOOK_SECRET=secret;try{const timestamp=Math.floor(Date.now()/1000);const payload=JSON.stringify({id:'evt_test_1',type:'payment_intent.succeeded',created:timestamp,data:{object:{id:'pi_test'}}});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${payload}`));const signature=Array.from(new Uint8Array(signed)).map(value=>value.toString(16).padStart(2,'0')).join('');const api=createApi(repo,{demo:true,allowLegacyCredentials:true});const request=()=>new Request('https://batyeo.test/api/core/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body:payload});assert.equal((await api.POST(request(),{params:Promise.resolve({path:['stripe','webhook']})})).status,200);assert.equal((await api.POST(request(),{params:Promise.resolve({path:['stripe','webhook']})})).status,200);assert.equal(repo.data.webhookEvents.length,1);}finally{if(previous===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=previous;}});
test('Financial and state injection on rental start is rejected before mutation',async()=>{const repo=new MemoryRepository(seedData('unused'));const count=repo.data.rentals.length;for(const field of ['state','amountCents','pricing','depositCents','partnerId']){const response=await call(repo,'start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:crypto.randomUUID(),[field]:'forged'});assert.equal(response.status,400);}assert.equal(repo.data.rentals.length,count);});
test('Invariant layer catches money corruption and orphan/cross-tenant data',()=>{for(const corrupt of [(d:Data)=>{d.payments[0].capturedCents=99999;},(d:Data)=>{d.stations[0].partnerId='partner-b';},(d:Data)=>{d.slots[0].batteryId='missing';},(d:Data)=>{d.rentals[0].commissionCents=99;}]){const d=seedData('unused');corrupt(d);assert.throws(()=>validateData(d));}});
test('Finance-only payment details and commissions are not leaked through rental projections',async()=>{const {repo,token}=await authenticated('SUPPORT');const response=await call(repo,'dashboard',undefined,token);const body=await response.json() as {payments:unknown[];rentals:Record<string,unknown>[]};assert.equal(body.payments.length,0);assert.ok(body.rentals.every(r=>!('payment' in r)&&!('commissionCents' in r)));const id=repo.data.rentals[0].id;const detail=await call(repo,'rentals/'+id,undefined,token);const row=await detail.json() as Record<string,unknown>;assert.equal('payment' in row,false);assert.equal('commissionCents' in row,false);});

test('HTTP enrollment survives API recreation, consumes once and stores only digests',async()=>{
 const {repo,token}=await authenticated();
 const issued=await call(repo,'runtime/enrollment-token',{stationId:'station-paris'},token);assert.equal(issued.status,201);
 const ticket=await issued.json() as {tokenId:string;token:string};
 const enrolled=await call(repo,'runtime/enroll',{tokenId:ticket.tokenId,token:ticket.token,runtimeId:'runtime-http'});assert.equal(enrolled.status,201);
 const credentials=await enrolled.json() as {credential:string};
 assert.equal(repo.data.runtimeCredentials[0].digest,await sha256(credentials.credential));
 assert.ok(!JSON.stringify(repo.data).includes(credentials.credential));assert.ok(!JSON.stringify(repo.data).includes(ticket.token));
 assert.equal((await call(repo,'runtime/enroll',{tokenId:ticket.tokenId,token:ticket.token,runtimeId:'replay'})).status,401);
 assert.equal((await call(repo,'runtime/revoke',{runtimeId:'runtime-http'})).status,401);
 assert.equal((await call(repo,'runtime/revoke',{runtimeId:'runtime-http'},token)).status,200);
 assert.notEqual(repo.data.runtimeCredentials[0].revokedAt,null);
});
test('partner cannot issue runtime enrollment tokens',async()=>{
 const {repo,token}=await authenticated('PARTNER_ADMIN');
 assert.equal((await call(repo,'runtime/enrollment-token',{stationId:'station-paris'},token)).status,403);
 assert.equal(repo.data.runtimeEnrollmentTokens.length,0);
});

test('runtime HTTP station access is scoped, rotates once and observes revocation',async()=>{
 const {repo,token}=await authenticated();
 const issued=await (await call(repo,'runtime/enrollment-token',{stationId:'station-paris'},token)).json() as {tokenId:string;token:string};
 const enrolled=await (await call(repo,'runtime/enroll',{tokenId:issued.tokenId,token:issued.token,runtimeId:'reader'})).json() as {credential:string};
 const read=(secret:string,stationId='station-paris')=>createApi(repo,{demo:true,allowLegacyCredentials:true}).GET(new Request(origin+'/api/core/runtime/station?stationId='+stationId,{headers:{authorization:'Bearer '+secret,'x-batyeo-runtime-id':'reader'}}),{params:Promise.resolve({path:['runtime','station']})});
 const response=await read(enrolled.credential);assert.equal(response.status,200);
 const safe=await response.json() as {station:{stationId:string}};assert.equal(safe.station.stationId,'station-paris');assert.ok(!JSON.stringify(safe).includes('digest'));
 assert.equal((await read(enrolled.credential,'station-lyon')).status,403);
 assert.equal((await call(repo,'runtime/station',undefined,token)).status,401);
 const rotated=await call(repo,'runtime/rotate',{runtimeId:'reader',expectedVersion:1},token);assert.equal(rotated.status,200);
 const fresh=await rotated.json() as {credential:string};
 assert.equal((await read(enrolled.credential)).status,401);assert.equal((await read(fresh.credential)).status,200);
 assert.equal((await call(repo,'runtime/rotate',{runtimeId:'reader',expectedVersion:1},token)).status,409);
 await call(repo,'runtime/revoke',{runtimeId:'reader'},token);assert.equal((await read(fresh.credential)).status,401);
});
