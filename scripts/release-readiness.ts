import {resolveOperator} from '../core/operator';
type Readiness='READY'|'PARTIALLY_READY'|'BLOCKED'|'MOCK'|'NOT_VERIFIED';
const configured=(k:string)=>Boolean(process.env[k]?.trim());
const payment=process.env.PAYMENT_PROVIDER;
const statuses:Record<string,Readiness>={
 Core:'READY',Web:'READY',
 // The app cannot show the card form: it only works against a mock deployment.
 Mobile:'PARTIALLY_READY',
 PostgreSQL:configured('DATABASE_URL')?'READY':'BLOCKED',
 // stripe_test was exercised end to end on the real deployment; live money has not been.
 Stripe:payment==='stripe_live'?'NOT_VERIFIED':payment==='stripe_test'?'READY':'MOCK',
 // Read-only cabinet/query confirmed against DTA55480 on 2026-09-18.
 'Bajie (lecture)':process.env.MANUFACTURER_PROVIDER==='bajie'?'READY':'BLOCKED',
 // No battery has ever been popped by BATYEO, whatever the flag says.
 'Sortie physique':'NOT_VERIFIED',
 // Without a delivered warning no lost battery is ever charged (see server/http.ts internal/cron).
 'Emails (Resend)':configured('RESEND_API_KEY')&&configured('MAIL_FROM')?'NOT_VERIFIED':'BLOCKED',
 'Mentions légales':resolveOperator(process.env).complete?'READY':'BLOCKED',
 'Application borne (APK)':'NOT_VERIFIED',
 'App Store':'BLOCKED','Google Play':'BLOCKED',
};
if(process.env.READINESS_JSON==='true') console.log(JSON.stringify({generatedAt:new Date().toISOString(),statuses},null,2));
else for(const [name,status] of Object.entries(statuses)) console.log(`${status.padEnd(16)} ${name}`);
if(process.env.READINESS_STRICT==='true') {
  const values=Object.values(statuses);
  if(values.includes('BLOCKED')) process.exitCode=1;
  else if(values.includes('PARTIALLY_READY')||values.includes('NOT_VERIFIED')) process.exitCode=2;
}
