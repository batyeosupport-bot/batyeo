import {validateData} from '../../core/invariants';

import {emptyData,type Data} from '../../core/types';
import {seedData} from '../../core/seed';
import {DomainError} from '../../core/providers';
import {createPasswordHash} from '../../core/security';
import type {Repository} from '../../core/repository';
const tables=Object.keys(emptyData()) as (keyof Data)[];
/** Each logical model is persisted separately. A revision CAS + conditional writes in one
 * atomic D1 batch prevents lost updates, double reservations and duplicate financial actions.
 * Retry callbacks must be pure: real providers will require a transactional outbox. */
export class D1Repository implements Repository {
 constructor(private readonly binding:D1Database) {}
 private db(){return this.binding;}
 private async snapshot(){
  const db=this.db();
  const rows=await db.batch<{payload:string;version:number}>([db.prepare('SELECT version FROM revision WHERE id = 1'),...tables.map(t=>db.prepare(`SELECT payload FROM "${t}"`))]);
  const data=emptyData();for(let i=0;i<tables.length;i++)Object.assign(data,{[tables[i]]:rows[i+1].results.map(r=>JSON.parse(String(r.payload)) as unknown)});
  return {version:Number(rows[0].results[0]?.version??0),data};
 }
 private async save(before:Data,after:Data,version:number){
  validateData(after);const db=this.db(),token=crypto.randomUUID();
  const statements=[db.prepare('UPDATE revision SET version = version + 1, token = ? WHERE id = 1 AND version = ?').bind(token,version)];
  for(const table of tables){
   const old=new Map(before[table].map(r=>[r.id,JSON.stringify(r)]));
   for(const row of after[table]){const json=JSON.stringify(row);if(old.get(row.id)!==json)statements.push(db.prepare(`INSERT INTO "${table}" (id,payload) SELECT ?,? WHERE EXISTS(SELECT 1 FROM revision WHERE id=1 AND token=?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).bind(row.id,json,token));old.delete(row.id);}
   for(const id of old.keys())statements.push(db.prepare(`DELETE FROM "${table}" WHERE id=? AND EXISTS(SELECT 1 FROM revision WHERE id=1 AND token=?)`).bind(id,token));
  }
  const result=await db.batch(statements);return result[0].meta.changes===1;
 }
 async initialize(){
  const db=this.db();await db.prepare('INSERT OR IGNORE INTO revision (id,version,token) VALUES (1,0,?)').bind('initial').run();
  const snapshot=await this.snapshot();
  if(snapshot.version===0){const seeded=seedData('pending');for(const u of seeded.users)u.passwordHash=await createPasswordHash('BatyeoDemo!2026');await this.save(snapshot.data,seeded,0);}
  else {
   // Bounded legacy fixture repair; preserve all identities, sessions and rental history.
   const duplicate=snapshot.data.users.find(u=>u.id==='admin'&&u.role==='ADMIN'&&u.email==='admin@batyeo.demo');
   if(duplicate&&snapshot.data.users.some(u=>u.id==='admin-demo'&&u.role==='SUPER_ADMIN'&&u.email==='admin@batyeo.demo')){
    const next=structuredClone(snapshot.data);next.users.find(u=>u.id===duplicate.id)!.email='team-admin@batyeo.demo';await this.save(snapshot.data,next,snapshot.version);
   }
  }
 }
 async read(){await this.initialize();return (await this.snapshot()).data;}
 async transaction<T>(fn:(d:Data)=>T):Promise<T>{
  await this.initialize();for(let attempt=0;attempt<5;attempt++){const {data,version}=await this.snapshot();const next=structuredClone(data);const value=fn(next);if(await this.save(data,next,version))return value;}
  throw new DomainError('Une opération est en cours. Réessayez dans un instant.',409);
 }
}

