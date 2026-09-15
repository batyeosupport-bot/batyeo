type Readiness='READY'|'PARTIALLY_READY'|'BLOCKED'|'MOCK'|'NOT_VERIFIED';
const configured=(k:string)=>Boolean(process.env[k]?.trim());
const statuses:Record<string,Readiness>={
 Core:'READY',Web:'READY',Mobile:'PARTIALLY_READY',
 PostgreSQL:configured('DATABASE_URL')?'NOT_VERIFIED':'BLOCKED',
 Stripe:process.env.PAYMENT_PROVIDER==='stripe_test'?'NOT_VERIFIED':'MOCK',
 Bajie:process.env.MANUFACTURER_PROVIDER==='bajie'?'NOT_VERIFIED':'BLOCKED',
 'Station Runtime':'READY',
 'Hardware actions':process.env.MANUFACTURER_ALLOW_PHYSICAL_ACTIONS==='true'?'BLOCKED':'READY',
 'App Store':'BLOCKED','Google Play':'BLOCKED',
};
if(process.env.READINESS_JSON==='true') console.log(JSON.stringify({generatedAt:new Date().toISOString(),statuses},null,2));
else for(const [name,status] of Object.entries(statuses)) console.log(`${status.padEnd(16)} ${name}`);
if(process.env.READINESS_STRICT==='true') {
  const values=Object.values(statuses);
  if(values.includes('BLOCKED')) process.exitCode=1;
  else if(values.includes('PARTIALLY_READY')||values.includes('NOT_VERIFIED')) process.exitCode=2;
}
