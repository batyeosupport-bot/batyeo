/**
 * Reads the configuration through the exact validators the server runs at startup, so a PASS here
 * means the server will actually boot. The previous version asked core/feature-flags.ts, a second
 * set of rules nothing else consulted: it rejected stripe_live, which the server supports, and
 * accepted names (PHYSICAL_ACTIONS_ENABLED, SCHEDULER_SECRET) the server never reads.
 */
import {resolvePaymentMode} from '../core/payment-mode';
import {validateManufacturerStartup} from '../core/manufacturer';
import {resolveMailer} from '../core/mailer';
const env=(key:string)=>process.env[key]?.trim()||'';
const check=(label:string,ok:boolean,missing=false)=>console.log(`${ok?'PASS':missing?'NOT_CONFIGURED':'FAIL'} ${label}`);
const guard=(label:string,run:()=>unknown,optional=false)=>{
 try{run();check(label,true);}
 catch(error){check(`${label}: ${error instanceof Error?error.message:'configuration invalide'}`,false,optional);}
};
check('NODE_ENV',!!env('NODE_ENV'),!env('NODE_ENV'));
check('DATABASE_URL',!!env('DATABASE_URL'),!env('DATABASE_URL'));
guard('PAYMENT_PROVIDER',()=>{
 const mode=resolvePaymentMode(process.env);
 const pk=env('STRIPE_PUBLISHABLE_KEY'),prefix=mode==='stripe_live'?'pk_live_':'pk_test_';
 if(mode!=='mock'&&!pk)throw new Error('STRIPE_PUBLISHABLE_KEY manquante : le formulaire de carte ne peut pas s’afficher.');
 if(mode!=='mock'&&!pk.startsWith(prefix))throw new Error(`STRIPE_PUBLISHABLE_KEY doit commencer par ${prefix} pour le mode ${mode}.`);
});
guard('MANUFACTURER',()=>validateManufacturerStartup(process.env));
check('PHYSICAL_ACTIONS_DISABLED',env('MANUFACTURER_ALLOW_PHYSICAL_ACTIONS')!=='true');
check('CRON_SECRET',!!env('CRON_SECRET'),!env('CRON_SECRET'));
check('STRIPE_WEBHOOK_SECRET',!!env('STRIPE_WEBHOOK_SECRET'),!env('STRIPE_WEBHOOK_SECRET'));
// Without a mailer the nightly job captures a deposit having sent no warning, which the privacy
// page promises never to do — so this is a prerequisite to real money, not a nicety.
guard('MAILER',()=>{if(!env('RESEND_API_KEY')&&!env('MAIL_FROM')){if(resolvePaymentMode(process.env)==='stripe_live')throw new Error('RESEND_API_KEY et MAIL_FROM sont obligatoires en argent réel : sans eux une caution est encaissée sans avertissement.');throw new Error('non configuré — aucun email ne part.');}resolveMailer(process.env);},resolvePaymentMode(process.env)!=='stripe_live');
console.log('NOT_VERIFIED database reachability and migration status (doctor is non-destructive)');
