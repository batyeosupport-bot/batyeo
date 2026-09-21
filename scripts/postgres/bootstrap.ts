import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaRepository} from '../../infrastructure/postgres/repository';
import {bootstrapOperator,retireDemoAccounts} from '../../core/accounts';
import {createPasswordHash} from '../../core/security';
import {DEFAULT_PRICING} from '../../core/pricing';

// Usage (never reads .env implicitly — the target database must be named on the command line):
//   BATYEO_CONFIRM_DATABASE=<host de la base> DATABASE_URL=... BATYEO_ADMIN_EMAIL=... BATYEO_ADMIN_NAME=... pnpm db:bootstrap
//   ... pnpm db:bootstrap -- --retire-demo     (verrouille les comptes @batyeo.demo d'une base déjà semée)
const url=process.env.DATABASE_URL,email=process.env.BATYEO_ADMIN_EMAIL,name=process.env.BATYEO_ADMIN_NAME;
const retireOnly=process.argv.includes('--retire-demo');
if(!url)throw new Error('DATABASE_URL est requis.');
// A wrong DATABASE_URL in the shell is exactly how a production database gets touched by mistake;
// making the operator type the host they mean turns that into a refusal instead of an incident.
const host=new URL(url).hostname;
if(process.env.BATYEO_CONFIRM_DATABASE!==host)throw new Error(`Confirmation manquante : BATYEO_CONFIRM_DATABASE doit valoir exactement « ${host} » (l'hôte de la base ciblée).`);
if(!retireOnly&&(!email||!name))throw new Error('BATYEO_ADMIN_EMAIL et BATYEO_ADMIN_NAME sont requis.');
const client=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
try{
 const repository=new PrismaRepository(client);
 if(retireOnly){
  const result=await repository.transaction(d=>retireDemoAccounts(d));
  console.log(`${result.retired} compte(s) de démonstration verrouillé(s).`);
 }else{
  const password=crypto.randomUUID().replace(/-/g,'').slice(0,20);
  const hash=await createPasswordHash(password);
  await repository.transaction(d=>bootstrapOperator(d,{email:email!,name:name!},hash,{...DEFAULT_PRICING}));
  console.log(`Administrateur créé : ${email}`);
  console.log(`Mot de passe temporaire (affiché UNE SEULE FOIS, changez-le dès la première connexion) : ${password}`);
 }
}finally{await client.$disconnect();}
