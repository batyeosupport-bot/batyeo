import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaRepository} from './postgres/repository';
import type {Repository} from '../core/repository';
import {validateManufacturerStartup} from '../core/manufacturer';
let repository:Repository|undefined;
export const runtimeOptions={demo:false,allowLegacyCredentials:false};
/** Native Next.js/Node composition root. Missing PostgreSQL config fails closed. */
export function getRepository():Repository {
 if(repository)return repository;
 const connectionString=process.env.DATABASE_URL;
 if(!connectionString?.match(/^postgres(ql)?:\/\//))throw new Error('DATABASE_URL PostgreSQL is required. SQLite fallback is disabled.');
 validateManufacturerStartup(process.env);
 const adapter=new PrismaPg({connectionString,max:10,connectionTimeoutMillis:5000});
 return repository=new PrismaRepository(new PrismaClient({adapter}));
}
