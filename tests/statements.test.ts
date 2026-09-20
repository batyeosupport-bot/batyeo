import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {sha256} from '../core/security';
import {RentalEngine} from '../core/rental';
import {partnerStatements,statementsCsv} from '../core/statements';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {constructor(public data:Data){}async read(){return structuredClone(this.data);}async transaction<T>(fn:(d:Data)=>T){const next=structuredClone(this.data),v=fn(next);validateData(next);this.data=next;return v;}}
const origin='https://batyeo.test';
async function session(repo:MemoryRepository,userId:string){const token=crypto.randomUUID()+crypto.randomUUID();repo.data.sessions.push({id:await sha256(token),userId,expiresAt:Date.now()+100_000,authVersion:0});return token;}

test('a statement totals what each partner is owed for the period, counting rentals by their return date',()=>{
 const d=seedData('x');const engine=new RentalEngine();
 const inside=engine.start(d,'c-in','station-paris','k-in',1_000);
 engine.return(d,inside.id,'station-paris',5_000);
 const outside=engine.start(d,'c-out','station-paris','k-out',1_000);
 engine.return(d,outside.id,'station-paris',50_000);
 const [paris]=partnerStatements(d,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null},0,10_000).filter(s=>s.partnerId==='partner-a');
 const rentalsInWindow=d.rentals.filter(r=>r.partnerId==='partner-a'&&r.returnedAt!==null&&r.returnedAt<10_000);
 assert.equal(paris.rentals,rentalsInWindow.length);
 assert.ok(rentalsInWindow.some(r=>r.id===inside.id)&&!rentalsInWindow.some(r=>r.id===outside.id),'the boundary is the return date, not the start');
 assert.equal(paris.commissionCents,rentalsInWindow.reduce((s,r)=>s+r.commissionCents,0));
 assert.equal(paris.netCents,paris.grossCents-paris.refundedCents);
});

test('a refund lowers the takings but never the commission already frozen in the rental',()=>{
 const d=seedData('x');const engine=new RentalEngine();
 const rental=engine.start(d,'c-ref','station-paris','k-ref',1_000);
 engine.return(d,rental.id,'station-paris',5_000);
 const actor={id:'admin-demo',role:'SUPER_ADMIN' as const,partnerId:null};
 const before=partnerStatements(d,actor,0,10_000).find(s=>s.partnerId==='partner-a')!;
 engine.markRefunded(d,rental.id,100);
 const after=partnerStatements(d,actor,0,10_000).find(s=>s.partnerId==='partner-a')!;
 assert.equal(after.refundedCents,before.refundedCents+100);
 assert.equal(after.netCents,before.netCents-100);
 assert.equal(after.commissionCents,before.commissionCents,'the partner share stays as agreed at the time of the rental');
});

test('a partner only ever sees their own statement, and the CSV opens straight in a French spreadsheet',async()=>{
 const repo=new MemoryRepository(seedData('x'));
 const post=(token:string,body:unknown)=>createApi(repo,{demo:true,allowLegacyCredentials:true},{}).POST(new Request(origin+'/api/core/finance/statement',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)}),{params:Promise.resolve({path:['finance','statement']})});
 const own=await post(await session(repo,'partner-demo'),{from:0,to:Date.now()});
 assert.equal(own.status,200);
 const body=await own.json() as {statements:{partnerId:string}[]};
 assert.deepEqual([...new Set(body.statements.map(s=>s.partnerId))],['partner-a'],'never another tenant’s money');
 assert.equal((await post(await session(repo,'operations'),{from:0,to:Date.now()})).status,403,'OPERATIONS has no money capability');
 assert.equal((await post(await session(repo,'admin-demo'),{from:10,to:10})).status,400,'an empty period is refused rather than silently returning zeros');

 const csv=statementsCsv(partnerStatements(repo.data,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null},0,Date.now()));
 const [header,first]=csv.split('\n');
 assert.equal(header,'Partenaire;Du;Au;Locations;Encaisse;Rembourse;Net;Commission a verser');
 assert.equal(first.split(';').length,8);
 assert.match(first,/\d+,\d{2}/,'comma decimals, as a French spreadsheet expects');
});
