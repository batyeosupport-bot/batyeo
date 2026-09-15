import {access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Client} from 'pg';
const url=process.env.DATABASE_URL?.trim()||'';
let localMigrations:string[]=[];
const migrationsPath=join(process.cwd(),'prisma','migrations');
try { localMigrations=(await readdir(migrationsPath,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(); } catch { /* reported below */ }
console.log(`${url?'NOT_VERIFIED':'NOT_CONFIGURED'} DATABASE_URL`);
if(url){
  const client=new Client({connectionString:url,connectionTimeoutMillis:5_000});
  try { await client.connect(); const result=await client.query<{name:string}>('SELECT current_database() AS name'); console.log(`PASS PostgreSQL reachable (${result.rows[0]?.name??'database'})`); const migrations=await client.query<{migration_name:string}>('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name'); const applied=new Set(migrations.rows.map(row=>row.migration_name)); const pending=localMigrations.filter(name=>!applied.has(name)); console.log(`PASS Prisma migration ledger readable (${migrations.rows.length} applied)`); console.log(`${pending.length?'FAIL':'PASS'} migration parity (${pending.length?`${pending.length} pending`:'up to date'})`); const indexes=await client.query<{count:string}>('SELECT COUNT(*)::text AS count FROM pg_indexes WHERE schemaname = current_schema()'); const constraints=await client.query<{count:string}>('SELECT COUNT(*)::text AS count FROM information_schema.table_constraints WHERE table_schema = current_schema()'); console.log(`PASS indexes readable (${indexes.rows[0]?.count??'0'})`); console.log(`PASS constraints readable (${constraints.rows[0]?.count??'0'})`); }
  catch(error){ console.log(`FAIL PostgreSQL connectivity (${error instanceof Error?error.message:'unavailable'})`); }
  finally { await client.end().catch(()=>undefined); }
}
const schemaPath=join(process.cwd(),'prisma','schema.prisma');
try { await access(schemaPath); console.log('PASS prisma schema present'); } catch { console.log('FAIL prisma schema missing'); }
try {
  const folders=(await readdir(migrationsPath,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  localMigrations=folders;
  const duplicatePrefixes=new Set(folders.map(name=>name.split('_')[0])).size!==folders.length;
  const lock=folders.length>0;
  console.log(`${lock?'PASS':'FAIL'} ordered Prisma migrations (${folders.length})`);
  console.log(`${duplicatePrefixes?'FAIL':'PASS'} migration prefixes unique`);
  try { await access(join(migrationsPath,'migration_lock.toml')); console.log('PASS migration lock present'); } catch { console.log('FAIL migration lock missing'); }
} catch { console.log('FAIL Prisma migrations directory missing'); }
console.log('NOT_VERIFIED migration status, constraints and indexes (requires reachable staging PostgreSQL)');
