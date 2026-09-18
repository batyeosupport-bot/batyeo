import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
function withEnv<T>(vars:Record<string,string|undefined>,run:()=>T):T{
 const previous=Object.fromEntries(Object.keys(vars).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(vars))if(value===undefined)delete process.env[key];else process.env[key]=value;
 try{return run();}
 finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

/**
 * Confirmed live on 2026-09-19: a misconfigured STRIPE_SECRET_KEY on the Vercel deployment made
 * every route — including ones with nothing to do with Stripe — return an empty 500. The cause was
 * resolvePaymentMode() throwing synchronously inside createApi() itself, before handle()'s
 * try/catch (which formats DomainError into clean JSON) had even been constructed.
 */
test('a startup configuration error surfaces as the same clean {error,status} JSON as any other DomainError, not an empty 500',()=>withEnv({PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:'pk_test_wrong_key_type'},async()=>{
 const api=createApi(new MemoryRepository(seedData('unused')),{demo:true,allowLegacyCredentials:true});
 const request=new Request('https://batyeo.test/api/core/health');
 const response=await api.GET(request,{params:Promise.resolve({path:['health']})});
 assert.equal(response.status,503);
 const body=await response.json() as {error:string};
 assert.equal(body.error,'Stripe TEST nécessite STRIPE_SECRET_KEY.');
}));
test('the same startup error is consistent across every route, not just the one first hit',()=>withEnv({PAYMENT_PROVIDER:'stripe_test',STRIPE_SECRET_KEY:''},async()=>{
 const api=createApi(new MemoryRepository(seedData('unused')),{demo:true,allowLegacyCredentials:true});
 for(const path of ['health','public']){
  const response=await api.GET(new Request('https://batyeo.test/api/core/'+path),{params:Promise.resolve({path:[path]})});
  assert.equal(response.status,503);
 }
}));
