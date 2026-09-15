const e=(k:string)=>process.env[k]?.trim()||'';
console.log(`${e('DATABASE_URL')?'NOT_VERIFIED':'NOT_CONFIGURED'} station database`);
console.log(`${e('MANUFACTURER_PROVIDER')==='bajie'?'NOT_VERIFIED':'NOT_CONFIGURED'} manufacturer read-only provider`);
console.log(`${e('MANUFACTURER_ALLOW_PHYSICAL_ACTIONS')==='true'?'FAIL':'PASS'} physical actions disabled`);
console.log('NOT_VERIFIED station mapping, heartbeat, unresolved commands and reconciliation (requires staging DB)');
