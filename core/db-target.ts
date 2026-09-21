/**
 * Prisma's schema names two URLs: DATABASE_URL (the app) and DIRECT_DATABASE_URL (migrations). The
 * migration command uses the second, and Prisma quietly fills whichever one is missing from the
 * project's .env — which holds the PRODUCTION database. So typing only DATABASE_URL on the command
 * line, the obvious thing to do, would have migrated production while looking like it targeted staging.
 * This is checked before Prisma is ever started: both URLs must be given on the command line, they
 * must point at the same project, and the operator must retype which project that is.
 */
export function projectRef(url:string):string{
 const parsed=new URL(url);
 // Supabase: pooler users look like "postgres.<ref>", direct hosts like "db.<ref>.supabase.co".
 const fromUser=decodeURIComponent(parsed.username).split('.')[1];
 const fromHost=parsed.hostname.startsWith('db.')?parsed.hostname.split('.')[1]:undefined;
 return fromUser||fromHost||parsed.hostname;
}
export function assertSafeMigrationTarget(env:Record<string,string|undefined>):{ref:string}{
 const direct=env.DIRECT_DATABASE_URL,pooled=env.DATABASE_URL;
 if(!direct||!pooled)throw new Error('DATABASE_URL et DIRECT_DATABASE_URL doivent toutes deux être données dans la commande. Sans cela, l’une des deux est reprise du fichier .env, qui pointe la production.');
 const directRef=projectRef(direct),pooledRef=projectRef(pooled);
 if(directRef!==pooledRef)throw new Error(`Les deux adresses ne visent pas la même base (${pooledRef} et ${directRef}). Migration refusée.`);
 if(env.BATYEO_CONFIRM_DATABASE!==directRef)throw new Error(`Confirmation manquante : BATYEO_CONFIRM_DATABASE doit valoir exactement « ${directRef} » (le projet visé).`);
 return {ref:directRef};
}
