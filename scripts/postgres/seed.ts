import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaRepository} from '../../infrastructure/postgres/repository';
import {seedData} from '../../core/seed';
import {createPasswordHash} from '../../core/security';
const url=process.env.DATABASE_URL;
const password=process.env.BATYEO_DEMO_PASSWORD;
if(process.env.BATYEO_ALLOW_DEMO_SEED!=='true'||!url||!password||password.length<16)throw new Error('Explicit BATYEO_ALLOW_DEMO_SEED=true, DATABASE_URL and a 16+ character BATYEO_DEMO_PASSWORD are required.');
const client=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
try{
 const repository=new PrismaRepository(client);
 const data=seedData('pending');for(const u of data.users)u.passwordHash=await createPasswordHash(password);
 await repository.transaction(current=>{
  if(current.users.length||current.rentals.length||current.stations.length)throw new Error('Seed refused: database is not empty. Existing data is never reset.');
  Object.assign(current,data);
 });
 console.log('Synthetic PostgreSQL fixture created. Password is not logged.');
}finally{await client.$disconnect();}
