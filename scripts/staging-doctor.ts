import {readFeatureFlags} from '../core/feature-flags';
const env=(key:string)=>process.env[key]?.trim()||'';
const check=(label:string,ok:boolean,missing=false)=>console.log(`${ok?'PASS':missing?'NOT_CONFIGURED':'FAIL'} ${label}`);
check('NODE_ENV',!!env('NODE_ENV'),!env('NODE_ENV'));
check('DATABASE_URL',!!env('DATABASE_URL'),!env('DATABASE_URL'));
check('PAYMENT_PROVIDER',!env('PAYMENT_PROVIDER')||env('PAYMENT_PROVIDER')==='mock'||env('PAYMENT_PROVIDER')==='stripe_test');
check('MANUFACTURER_PROVIDER',!env('MANUFACTURER_PROVIDER')||env('MANUFACTURER_PROVIDER')==='disabled'||env('MANUFACTURER_PROVIDER')==='bajie');
check('PHYSICAL_ACTIONS_DISABLED',env('MANUFACTURER_ALLOW_PHYSICAL_ACTIONS')!=='true');
check('MANUFACTURER_SYNC_SECRET',!!env('MANUFACTURER_SYNC_SECRET'),!env('MANUFACTURER_SYNC_SECRET'));
check('OVERDUE_CAPTURE_SECRET',!!env('OVERDUE_CAPTURE_SECRET'),!env('OVERDUE_CAPTURE_SECRET'));
check('SCHEDULER_SECRET',!!env('SCHEDULER_SECRET'),!env('SCHEDULER_SECRET'));
check('RUNTIME_API_BASE_URL',!!env('RUNTIME_API_BASE_URL'),!env('RUNTIME_API_BASE_URL'));
try { readFeatureFlags(process.env); check('FEATURE_FLAGS',true); }
catch (error) { check(`FEATURE_FLAGS: ${error instanceof Error ? error.message : 'invalid configuration'}`,false); }
console.log('NOT_VERIFIED database reachability and migration status (doctor is non-destructive)');
