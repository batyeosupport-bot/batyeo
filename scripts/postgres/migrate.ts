import {spawnSync} from 'node:child_process';
import {assertSafeMigrationTarget} from '../../core/db-target';

// Usage — depuis le dossier du projet, jamais depuis ~ :
//   BATYEO_CONFIRM_DATABASE=<ref du projet> DATABASE_URL="…" DIRECT_DATABASE_URL="…" pnpm db:migrate
let ref:string;
try{({ref}=assertSafeMigrationTarget(process.env));}
catch(error){console.error(`\nMIGRATION REFUSÉE — ${error instanceof Error?error.message:'configuration invalide'}\n`);process.exit(1);}
console.log(`Migration de la base du projet « ${ref} » (les migrations ajoutent, n'effacent rien).`);
const result=spawnSync('pnpm',['prisma','migrate','deploy'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
