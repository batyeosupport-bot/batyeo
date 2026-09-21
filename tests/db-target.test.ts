import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSafeMigrationTarget,projectRef} from '../core/db-target';

const STAGING_POOL='postgresql://postgres.stagingref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
const STAGING_DIRECT='postgresql://postgres:pw@db.stagingref.supabase.co:5432/postgres';
const PROD_POOL='postgresql://postgres.prodref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

test('the project is read from a Supabase pooler user or a direct host',()=>{
 assert.equal(projectRef(STAGING_POOL),'stagingref');
 assert.equal(projectRef(STAGING_DIRECT),'stagingref');
 assert.equal(projectRef('postgresql://batyeo:pw@localhost:5432/batyeo'),'localhost');
});

test('a migration is refused unless both URLs are given, agree with each other, and the operator retyped the project',()=>{
 // The trap that was real: only DATABASE_URL typed, DIRECT_DATABASE_URL silently taken from .env (production).
 assert.throws(()=>assertSafeMigrationTarget({DATABASE_URL:STAGING_DIRECT,BATYEO_CONFIRM_DATABASE:'stagingref'}),/DIRECT_DATABASE_URL/);
 assert.throws(()=>assertSafeMigrationTarget({DIRECT_DATABASE_URL:STAGING_DIRECT,BATYEO_CONFIRM_DATABASE:'stagingref'}),/DATABASE_URL/);
 assert.throws(()=>assertSafeMigrationTarget({DATABASE_URL:PROD_POOL,DIRECT_DATABASE_URL:STAGING_DIRECT,BATYEO_CONFIRM_DATABASE:'stagingref'}),/pas la même base/,'staging URL mixed with a production URL');
 assert.throws(()=>assertSafeMigrationTarget({DATABASE_URL:STAGING_POOL,DIRECT_DATABASE_URL:STAGING_DIRECT}),/Confirmation manquante.*stagingref/);
 assert.throws(()=>assertSafeMigrationTarget({DATABASE_URL:STAGING_POOL,DIRECT_DATABASE_URL:STAGING_DIRECT,BATYEO_CONFIRM_DATABASE:'prodref'}),/Confirmation manquante/,'confirming the wrong project is a refusal, not a warning');
 assert.deepEqual(assertSafeMigrationTarget({DATABASE_URL:STAGING_POOL,DIRECT_DATABASE_URL:STAGING_DIRECT,BATYEO_CONFIRM_DATABASE:'stagingref'}),{ref:'stagingref'});
});
