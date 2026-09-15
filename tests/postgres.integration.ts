import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaRepository} from '../infrastructure/postgres/repository';
import {seedData} from '../core/seed';
import {createPasswordHash} from '../core/security';
import {RentalEngine} from '../core/rental';
import {createApi} from '../server/http';
const url=process.env.BATYEO_TEST_DATABASE_URL;
if(!url)throw new Error('NOT VERIFIED: BATYEO_TEST_DATABASE_URL must point to a migrated, empty PostgreSQL test database.');
if(!new URL(url).pathname.includes('test'))throw new Error('Refusing a database whose name does not contain test.');
test('Native PostgreSQL: normalized persistence, concurrent starts/returns, rollback, auth and constraints',async()=>{
 const clients=[0,1].map(()=>new PrismaClient({adapter:new PrismaPg({connectionString:url,max:4})}));
 const repositories=clients.map(c=>new PrismaRepository(c));const [repo,other]=repositories;const engine=new RentalEngine();
 try{
  const data=seedData('pending');for(const u of data.users)u.passwordHash=await createPasswordHash('PostgresTestOnly!2026');
  await repo.transaction(current=>{assert.equal(current.users.length,0,'Use an empty isolated test database.');Object.assign(current,data);});
  const key=crypto.randomUUID();
  const starts=await Promise.all([repo,other].map(r=>r.transaction(d=>engine.start(d,'pg-customer','station-paris',key))));
  assert.equal(starts[0].id,starts[1].id);assert.equal(starts[0].state,'ACTIVE');const id=starts[0].id;
  const recovered=(await other.read()).rentals.find(r=>r.id===id)!;assert.equal(recovered.state,'ACTIVE');
  await Promise.all([repo,other].map(r=>r.transaction(d=>engine.return(d,id,'station-lyon',recovered.startedAt!+61*60000))));
  const final=await repo.read();const rental=final.rentals.find(r=>r.id===id)!;
  assert.equal(rental.state,'COMPLETED');assert.equal(rental.amountCents,400);assert.equal(final.payments.find(p=>p.rentalId===id)?.releasedCents,1600);assert.equal(final.events.filter(e=>e.rentalId===id&&e.type==='COMPLETED').length,1);
  await assert.rejects(()=>repo.transaction(d=>{d.stations[0].online=false;throw new Error('rollback');}));assert.equal((await other.read()).stations[0].online,true);
  await assert.rejects(()=>clients[0].payment.update({where:{rentalId:id},data:{capturedCents:99999}}));
  await assert.rejects(()=>clients[0].station.update({where:{id:'station-paris'},data:{partnerId:'partner-b'}}));
  const api=createApi(repo,{demo:true,allowLegacyCredentials:false});
  const login=await api.POST(new Request('https://batyeo.test/api/core/login',{method:'POST',headers:{origin:'https://batyeo.test','content-type':'application/json'},body:JSON.stringify({email:'partner@batyeo.demo',password:'PostgresTestOnly!2026'})}),{params:Promise.resolve({path:['login']})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const req=()=>new Request('https://batyeo.test/api/core/dashboard',{headers:{cookie}});
  const dashboard=await api.GET(req(),{params:Promise.resolve({path:['dashboard']})});const body=await dashboard.json() as {stations:{partnerId:string}[]};assert.ok(body.stations.every(s=>s.partnerId==='partner-a'));
  await repo.transaction(d=>{d.partnerUsers=d.partnerUsers.filter(m=>m.userId!=='partner-demo');});
  assert.equal((await api.GET(req(),{params:Promise.resolve({path:['dashboard']})})).status,401);
  // Two distinct customers racing the last available battery cannot both obtain it.
  await repo.transaction(d=>{const candidates=d.slots.filter(s=>s.stationId==='station-paris'&&s.batteryId);for(const [i,s] of candidates.entries())d.batteries.find(b=>b.id===s.batteryId)!.status=i===0?'AVAILABLE':'MAINTENANCE';});
  const race=await Promise.allSettled([repo,other].map((r,i)=>r.transaction(d=>engine.start(d,'race-'+i,'station-paris',crypto.randomUUID()))));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 }finally{await Promise.all(clients.map(c=>c.$disconnect()));}
});
