import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare}=wranglerRequire('miniflare');
const files=readdirSync('dist/server',{recursive:true}).filter(f=>f.endsWith('.js'));files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:0);
const mf=new Miniflare({modules:files.map(path=>({type:'ESModule',path:process.cwd()+'/dist/server/'+path,contents:readFileSync('dist/server/'+path,'utf8')})),modulesRoot:process.cwd()+'/dist/server',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'batyeo-integration'},cf:false});
const host='https://batyeo.test';
function client(){let cookie='';return async(path,body,expected=200)=>{const r=await mf.dispatchFetch(host+'/api/core/'+path,{method:body===undefined?'GET':'POST',headers:{origin:host,host:'batyeo.test','content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});const c=r.headers.get('set-cookie');if(c)cookie=[...cookie.split('; ').filter(x=>x&&!x.startsWith(c.split('=')[0]+'=')),c.split(';')[0]].join('; ');const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d;};}
try{
 const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const customer=client(),admin=client(),partner=client(),partnerB=client();
 const pub=await customer('public');assert.equal(pub.stations.length,3);await customer('customer');
 await admin('login',{email:'admin@batyeo.demo',password:'BatyeoDemo!2026'});
 await partner('login',{email:'partner@batyeo.demo',password:'BatyeoDemo!2026'});
 await partnerB('login',{email:'partner-b@batyeo.demo',password:'BatyeoDemo!2026'});
 const key=crypto.randomUUID();const results=await Promise.all([customer('start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:key}),customer('start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:key})]);assert.equal(results[0].rental.id,results[1].rental.id);const id=results[0].rental.id;
 assert.equal(results[0].rental.state,'ACTIVE');assert.equal((await customer('customer')).rental.id,id);
 assert.ok((await admin('dashboard')).rentals.some(r=>r.id===id));assert.ok((await partner('dashboard')).rentals.some(r=>r.id===id));assert.ok(!(await partnerB('dashboard')).rentals.some(r=>r.id===id));await partnerB('rentals/'+id,undefined,404);await partner('simulate',{action:'offline',stationId:'station-paris'},403);
 await admin('simulate',{action:'delay',stationId:'station-lyon',rentalId:id,minutes:61});
 await Promise.all([admin('simulate',{action:'return',stationId:'station-lyon',rentalId:id}),admin('simulate',{action:'return',stationId:'station-lyon',rentalId:id})]);
 const receipt=(await customer('customer')).rental;assert.equal(receipt.state,'COMPLETED');assert.equal(receipt.amountCents,400);assert.equal(receipt.payment.releasedCents,1600);assert.equal('providerReference' in receipt.payment,false);assert.equal('customerId' in receipt,false);assert.equal(receipt.events.filter(e=>e.type==='COMPLETED').length,1);
 console.log('PASS: real D1 golden flow, refresh, concurrent duplicate start/return, cross-station return, receipt, role and tenant isolation');
 const failure=client();await failure('customer');await admin('simulate',{action:'ejection',stationId:'station-paris'});const f=await failure('start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:crypto.randomUUID()});assert.equal(f.rental.state,'EJECTION_FAILED');assert.equal(f.rental.payment.releasedCents,2000);assert.equal(f.rental.payment.capturedCents,0);console.log('PASS: API failure flow and compensation');
 await customer('start',{stationPublicId:'paris-demo',termsAccepted:true,idempotencyKey:crypto.randomUUID(),amountCents:1},400);
 const csrf=await mf.dispatchFetch(host+'/api/core/simulate',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'});assert.equal(csrf.status,403);console.log('PASS: client financial injection rejected and cross-origin request rejected');
 const routes=['/','/how-it-works','/pricing','/stations','/for-business','/partners','/faq','/support','/contact','/terms','/privacy','/rent/paris-demo','/admin','/partner'];
 const destinations=new Set();
 for(const path of routes){
  const response=await mf.dispatchFetch(host+path);assert.equal(response.status,200,path);const html=await response.text();assert.ok(/batyeo/i.test(html),path);
  const anchors=[...html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').matchAll(/<a\s[^>]*>/g)].map(m=>m[0]);
  const brands=anchors.filter(tag=>tag.includes('aria-label="BATYEO accueil"'));
  assert.ok(brands.length>0,`${path}: logo accessible`);
  for(const tag of brands)assert.match(tag,/href="\/"/,`${path}: logo links home`);
  for(const tag of anchors){const href=tag.match(/href="([^"]*)"/)?.[1];assert.ok(href,`${path}: link without destination ${tag}`);assert.notEqual(href,'#',`${path}: inert link`);if(href.startsWith('/')&&!href.startsWith('//'))destinations.add(href);}
  if(path==='/')assert.ok(html.includes('id="main"'),'Skip link destination');
 }
 for(const path of destinations){const response=await mf.dispatchFetch(host+path);assert.ok(response.status>=200&&response.status<400,`${path}: broken link (${response.status})`);await response.text();}
 const ticket=await customer('ticket',{email:'navigation@batyeo.demo',subject:'Test assistance Web',message:'Vérification du formulaire de contact Web.'},201);assert.ok(ticket.id,'Contact form returns ticket reference');
 console.log(`PASS: ${routes.length} pages render, home logos and ${destinations.size} internal link destinations, contact submission`);
}finally{await mf.dispose();}
