import {spawnSync} from 'node:child_process';
import {assertSafeMigrationTarget} from '../../core/db-target';

// Usage — depuis le dossier du projet, jamais depuis ~ :
//   BATYEO_CONFIRM_DATABASE=<ref du projet> DATABASE_URL="…" DIRECT_DATABASE_URL="…" pnpm db:migrate
const {ref}=assertSafeMigrationTarget(process.env);
console.log(`Migration de la base du projet « ${ref} » (les migrations ajoutent, n'effacent rien).`);
const result=spawnSync('pnpm',['prisma','migrate','deploy'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
