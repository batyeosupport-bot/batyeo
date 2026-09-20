import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StripePaymentProvider,StripeWebhookLedger,createTerminalLocation,listTerminalLocations,verifyStripeSignature, type StripeRequest} from '../core/stripe';
import {resolvePaymentMode,isRealMoney} from '../core/payment-mode';
import {DomainError} from '../core/providers';

/** These two call Stripe through global fetch, like createTerminalConnectionToken does. */
async function withFetch<T>(handler:(url:string,init:RequestInit)=>Response,run:()=>Promise<T>):Promise<T>{
 const original=globalThis.fetch;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>handler(String(input),init??{})) as typeof fetch;
 try{return await run();}finally{globalThis.fetch=original;}
}
const stripeJson=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
const locationPayload={id:'tml_demo',display_name:'Hôtel Démo · paris-demo',address:{line1:'1 rue Démo',city:'Paris',postal_code:'75002',country:'FR',state:''}};

test('creating a Terminal Location posts the documented address fields and returns the tml_ id',async()=>{
 let seen:{url:string;body:string}|undefined;
 const created=await withFetch((url,init)=>{seen={url,body:String(init.body)};return stripeJson(locationPayload);},
  ()=>createTerminalLocation('sk_test_demo',{displayName:'Hôtel Démo · paris-demo',line1:'1 rue Démo',city:'Paris',country:'fr',postalCode:'75002'}));
 assert.equal(seen?.url,'https://api.stripe.com/v1/terminal/locations');
 const body=new URLSearchParams(seen!.body);
 assert.equal(body.get('display_name'),'Hôtel Démo · paris-demo');
 assert.equal(body.get('address[line1]'),'1 rue Démo');
 assert.equal(body.get('address[city]'),'Paris');
 assert.equal(body.get('address[country]'),'FR');// normalised from the lowercase input
 assert.equal(body.get('address[postal_code]'),'75002');
 assert.equal(body.get('address[state]'),null);// omitted rather than sent empty
 assert.equal(created.id,'tml_demo');
 assert.equal(created.city,'Paris');
});
test('Terminal Location creation refuses a live key, an invalid country and surfaces Stripe’s own error',async()=>{
 await assert.rejects(()=>createTerminalLocation('sk_live_demo',{displayName:'x',line1:'x',city:'x',country:'FR'}),(e:unknown)=>e instanceof DomainError&&e.status===503);
 await assert.rejects(()=>createTerminalLocation('sk_test_demo',{displayName:'x',line1:'x',city:'x',country:'France'}),(e:unknown)=>e instanceof DomainError&&e.status===400);
 await withFetch(()=>stripeJson({error:{message:'Invalid address.'}},400),async()=>{
  await assert.rejects(()=>createTerminalLocation('sk_test_demo',{displayName:'x',line1:'x',city:'x',country:'FR'}),(e:unknown)=>e instanceof DomainError&&e.message==='Invalid address.');
 });
});
test('listing Terminal Locations maps Stripe rows and ignores entries without an id',async()=>{
 const rows=await withFetch((url)=>{assert.ok(url.includes('/terminal/locations?limit=100'));return stripeJson({data:[locationPayload,{display_name:'incomplete'}]});},
  ()=>listTerminalLocations('sk_test_demo'));
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0],{id:'tml_demo',displayName:'Hôtel Démo · paris-demo',line1:'1 rue Démo',city:'Paris',postalCode:'75002',country:'FR',state:''});
});

test('Stripe TEST provider uses manual capture and deterministic idempotency',async()=>{const requests:StripeRequest[]=[];const provider=new StripePaymentProvider('sk_test_demo',async request=>{requests.push(request);return {id:'pi_demo',status:'requires_capture',amount:2000};});await provider.authorize('rental-1',2000);await provider.capture('pi_demo',400,'rental-1');await provider.release('pi_demo','rental-1');assert.equal(requests[0].body.capture_method,'manual');assert.equal(requests[0].idempotencyKey,'rental-rental-1-authorize');assert.equal(requests[1].body.amount_to_capture,400);assert.equal(requests[2].path,'/payment_intents/pi_demo/cancel');});
test('Stripe webhook ledger ignores duplicate success and retries failed delivery',async()=>{const ledger=new StripeWebhookLedger();let calls=0;const event={id:'evt_1',type:'payment_intent.succeeded',created:1,data:{object:{}}};await ledger.process(event,()=>{calls++;});await ledger.process(event,()=>{calls++;});assert.equal(calls,1);await assert.rejects(()=>ledger.process({id:'evt_2',type:'x',created:1,data:{object:{}}},()=>{throw new Error('temporary');}));await ledger.process({id:'evt_2',type:'x',created:1,data:{object:{}}},()=>{calls++;});assert.equal(calls,2);});
test('Stripe webhook signature rejects stale or malformed deliveries',async()=>{assert.equal(await verifyStripeSignature('{}','t=1,v1=00','secret',1000),false);assert.equal(await verifyStripeSignature('{}','invalid','secret',1),false);});
test('payment provider guard defaults to mock and refuses any key/mode mismatch',()=>{
 assert.equal(resolvePaymentMode({}),'mock','nothing configured can only ever mean fake money');
 assert.equal(resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_test_demo'}),'stripe_test');
 assert.equal(resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'stripe_live',STRIPE_SECRET_KEY:'sk_live_demo'}),'stripe_live');
 assert.throws(()=>resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'stripe_live',STRIPE_SECRET_KEY:'sk_test_demo'}),/sk_live_/,'a test key left behind must never be accepted as live');
 assert.throws(()=>resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'sk_live_demo'}),/sk_test_/,'and a live key must never be spent in test mode');
 assert.throws(()=>resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'stripe_test'}));
 assert.throws(()=>resolvePaymentMode({BATYEO_PAYMENT_PROVIDER:'paypal'}));
 assert.equal(isRealMoney('stripe_live'),true);
 assert.equal([isRealMoney('mock'),isRealMoney('stripe_test')].join(),'false,false');
});
