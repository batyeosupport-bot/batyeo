import test from 'node:test';
import assert from 'node:assert/strict';
import {createPasswordHash,sha256} from '../core/security';
import {seedData} from '../core/seed';
import {createApi} from '../server/http';
import {MFA_REQUIRED_MESSAGE,base32Encode,totpCode,totpStep,verifyTotp} from '../core/totp';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';
import {validateData} from '../core/invariants';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body?:unknown,token?:string){
 const request=new Request(origin+'/api/core/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:token?`batyeo_session=${token}`:''},body:body===undefined?undefined:JSON.stringify(body)});
 return createApi(repo,{demo:true,allowLegacyCredentials:false})[body===undefined?'GET':'POST'](request,{params:Promise.resolve({path:path.split('/')})});
}

test('codes match the RFC 6238 reference values, so any authenticator app agrees with the server',async()=>{
 const secret=base32Encode(new TextEncoder().encode('12345678901234567890'));
 assert.equal(await totpCode(secret,totpStep(59_000)),'287082');
 assert.equal(await totpCode(secret,totpStep(1_111_111_109_000)),'081804');
 assert.equal(await totpCode(secret,totpStep(2_000_000_000_000)),'279037');
});

test('a code is accepted one step early or late, never twice, and never malformed',async()=>{
 const secret=base32Encode(new TextEncoder().encode('12345678901234567890'));
 const now=1_111_111_109_000,step=totpStep(now);
 const code=await totpCode(secret,step);
 assert.equal(await verifyTotp(secret,code,now),step);
 assert.equal(await verifyTotp(secret,code,now+30_000),step,'a phone a few seconds behind still works');
 assert.equal(await verifyTotp(secret,code,now,step),null,'the same code cannot be replayed');
 assert.equal(await verifyTotp(secret,'12345',now),null);
});

test('an admin turns on the double vérification; from then on the password alone never opens the portal',async()=>{
 const data=seedData('x');const admin=data.users.find(u=>u.role==='SUPER_ADMIN')!;admin.passwordHash=await createPasswordHash('long-password-2026');
 const token=crypto.randomUUID()+crypto.randomUUID();data.sessions.push({id:await sha256(token),userId:admin.id,expiresAt:Date.now()+100_000,authVersion:0});
 const repo=new MemoryRepository(data);
 const setup=await (await call(repo,'account/2fa/setup',{},token)).json() as {secret:string;uri:string};
 assert.match(setup.uri,/^otpauth:\/\/totp\/BATYEO/);
 assert.equal((await call(repo,'account/2fa/enable',{code:'000000'},token)).status,403);
 assert.equal((await call(repo,'account/2fa/enable',{code:await totpCode(setup.secret,totpStep(Date.now()))},token)).status,200);
 const dashboard=await (await call(repo,'dashboard',undefined,token)).json() as {user:{twoFactor:boolean};team:{id:string;twoFactor:boolean}[]};
 assert.equal(dashboard.user.twoFactor,true);
 assert.equal(JSON.stringify(dashboard).includes(setup.secret),false,'the secret never leaves the server after setup');

 const passwordOnly=await call(repo,'login',{email:admin.email,password:'long-password-2026'});
 assert.equal(passwordOnly.status,401);
 assert.equal((await passwordOnly.json() as {error:string}).error,MFA_REQUIRED_MESSAGE);
 assert.equal((await call(repo,'login',{email:admin.email,password:'wrong-password-2026',code:'123456'})).status,401);
 const step=Math.max(totpStep(Date.now()),(repo.data.users.find(u=>u.id===admin.id)!.totpLastStep??0)+1);
 const code=await totpCode(setup.secret,step);
 const withCode=await call(repo,'login',{email:admin.email,password:'long-password-2026',code});
 assert.equal(withCode.status,200);
 assert.equal((await call(repo,'login',{email:admin.email,password:'long-password-2026',code})).status,401,'a code seen once cannot open a second session');
});

test('a lost phone: another admin resets the password, which also switches the double vérification off',async()=>{
 const data=seedData('x');const admin=data.users.find(u=>u.role==='SUPER_ADMIN')!,partner=data.users.find(u=>u.role==='PARTNER_ADMIN')!;
 partner.totpSecret='JBSWY3DPEHPK3PXP';partner.totpEnabledAt=1;partner.totpLastStep=5;
 const token=crypto.randomUUID()+crypto.randomUUID();data.sessions.push({id:await sha256(token),userId:admin.id,expiresAt:Date.now()+100_000,authVersion:0});
 const repo=new MemoryRepository(data);
 assert.equal((await call(repo,'team/reset-password',{userId:partner.id},token)).status,200);
 const after=repo.data.users.find(u=>u.id===partner.id)!;
 assert.equal(after.totpEnabledAt,null);assert.equal(after.totpSecret,null);
});
