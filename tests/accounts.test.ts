import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {createPasswordHash,verifyPassword,sha256} from '../core/security';
import {validateData} from '../core/invariants';
import {teamFor} from '../core/accounts';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body:unknown,token?:string){
 const headers:Record<string,string>={origin,'content-type':'application/json'};if(token)headers.cookie=`batyeo_session=${token}`;
 return createApi(repo,{demo:true,allowLegacyCredentials:true},{}).POST(new Request(origin+'/api/core/'+path,{method:'POST',headers,body:JSON.stringify(body)}),{params:Promise.resolve({path:path.split('/')})});
}
async function session(repo:MemoryRepository,userId:string){
 const user=repo.data.users.find(u=>u.id===userId)!;const token=crypto.randomUUID()+crypto.randomUUID();
 repo.data.sessions.push({id:await sha256(token),userId,expiresAt:Date.now()+100_000,authVersion:user.authVersion??0});return token;
}
const dashboardStatus=async(repo:Repository,token:string)=>(await createApi(repo,{demo:true,allowLegacyCredentials:true},{}).GET(new Request(origin+'/api/core/dashboard',{headers:{cookie:`batyeo_session=${token}`}}),{params:Promise.resolve({path:['dashboard']})})).status;

test('own password change requires the current password, keeps this session and drops the others',async()=>{
 const repo=new MemoryRepository(seedData('x'));
 const me=repo.data.users.find(u=>u.id==='partner-demo')!;me.passwordHash=await createPasswordHash('ancien-mot-de-passe');
 const here=await session(repo,'partner-demo'),elsewhere=await session(repo,'partner-demo');
 const wrong=await call(repo,'settings/password',{currentPassword:'pas-le-bon',newPassword:'un-nouveau-solide'},here);
 assert.equal(wrong.status,403);assert.ok(await verifyPassword('ancien-mot-de-passe',repo.data.users.find(u=>u.id==='partner-demo')!.passwordHash),'hash untouched by a refused attempt');
 assert.equal((await call(repo,'settings/password',{currentPassword:'ancien-mot-de-passe',newPassword:'court'},here)).status,400);
 assert.equal((await call(repo,'settings/password',{currentPassword:'ancien-mot-de-passe',newPassword:'ancien-mot-de-passe'},here)).status,400);
 const ok=await call(repo,'settings/password',{currentPassword:'ancien-mot-de-passe',newPassword:'un-nouveau-solide'},here);
 assert.equal(ok.status,200);
 assert.ok(await verifyPassword('un-nouveau-solide',repo.data.users.find(u=>u.id==='partner-demo')!.passwordHash));
 assert.equal(await dashboardStatus(repo,here),200,'the session that made the change stays valid');
 assert.equal(await dashboardStatus(repo,elsewhere),401,'every other session of that user is cut');
});

test('a partner admin manages only their own team: create, disable and re-enable',async()=>{
 const repo=new MemoryRepository(seedData('x'));const admin=await session(repo,'partner-demo'),colleague=await session(repo,'partner_user');
 const created=await call(repo,'team/create',{name:'Nouvelle Recrue',email:'  Recrue@Test.FR ',role:'PARTNER_USER',partnerId:'partner-b'},admin);
 assert.equal(created.status,201);
 const body=await created.json() as {member:{id:string;email:string};temporaryPassword:string};
 const member=repo.data.users.find(u=>u.id===body.member.id)!;
 assert.equal(member.email,'recrue@test.fr');assert.equal(member.partnerId,'partner-a','a PARTNER_ADMIN cannot place someone in another partner, whatever partnerId they send');
 assert.ok(repo.data.partnerUsers.some(m=>m.userId===member.id&&m.partnerId==='partner-a'));
 assert.ok(await verifyPassword(body.temporaryPassword,member.passwordHash));
 assert.equal((await call(repo,'team/create',{name:'Doublon',email:'recrue@test.fr',role:'PARTNER_USER'},admin)).status,409);
 assert.equal((await call(repo,'team/create',{name:'Pirate',email:'pirate@test.fr',role:'SUPER_ADMIN'},admin)).status,400,'only partner roles can be granted here');
 assert.equal((await call(repo,'team/create',{name:'Nope',email:'nope@test.fr',role:'PARTNER_USER'},colleague)).status,403,'a PARTNER_USER cannot add people');

 assert.equal(await dashboardStatus(repo,colleague),200);
 assert.equal((await call(repo,'team/set-disabled',{userId:'partner_user',disabled:true},admin)).status,200);
 assert.equal(await dashboardStatus(repo,colleague),401,'a disabled account is locked out immediately, even with a live session');
 assert.equal((await call(repo,'team/set-disabled',{userId:'partner_user',disabled:false},admin)).status,200);
 assert.equal(repo.data.users.find(u=>u.id==='partner_user')!.disabledAt,null);
 assert.equal((await call(repo,'team/set-disabled',{userId:'partner-demo',disabled:true},admin)).status,403,'nobody can lock themselves out');
 assert.equal((await call(repo,'team/set-disabled',{userId:'partner-b-demo',disabled:true},admin)).status,404,'another tenant’s account is invisible');
 assert.equal((await call(repo,'team/reset-password',{userId:'partner-b-demo'},admin)).status,404);
});

test('staff rules: ADMIN cannot touch a SUPER_ADMIN, SUPER_ADMIN can; reset gives a working one-time password and cuts old sessions',async()=>{
 const repo=new MemoryRepository(seedData('x'));const staff=await session(repo,'admin'),root=await session(repo,'admin-demo'),victim=await session(repo,'partner-demo');
 assert.equal((await call(repo,'team/set-disabled',{userId:'admin-demo',disabled:true},staff)).status,403);
 const reset=await call(repo,'team/reset-password',{userId:'partner-demo'},root);
 assert.equal(reset.status,200);const body=await reset.json() as {email:string;temporaryPassword:string};
 assert.equal(body.email,'partner@batyeo.demo');assert.match(body.temporaryPassword,/^[a-f0-9]{16}$/);
 assert.equal(await dashboardStatus(repo,victim),401,'the old session dies with the old password');
 const login=await call(repo,'login',{email:'partner@batyeo.demo',password:body.temporaryPassword});
 assert.equal(login.status,200);
});

test('the dashboard exposes the team only to roles that can manage it, scoped to their tenant, never with hashes',async()=>{
 const d=seedData('x');
 const asPartner=teamFor(d,{id:'partner-demo',role:'PARTNER_ADMIN',partnerId:'partner-a'});
 assert.ok(asPartner.length>=2&&asPartner.every(m=>m.partnerId==='partner-a'));
 assert.ok(asPartner.every(m=>!('passwordHash' in m)));
 assert.deepEqual(teamFor(d,{id:'partner_user',role:'PARTNER_USER',partnerId:'partner-a'}),[]);
 assert.deepEqual(teamFor(d,{id:'finance',role:'FINANCE',partnerId:null}),[]);
 assert.equal(teamFor(d,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null}).length,d.users.length);
});

test('system/status tells BATYEO staff the lock is closed and payment mode, and is refused to partners',async()=>{
 const repo=new MemoryRepository(seedData('x'));
 const get=(token:string)=>createApi(repo,{demo:true,allowLegacyCredentials:true},{}).GET(new Request(origin+'/api/core/system/status',{headers:{cookie:`batyeo_session=${token}`}}),{params:Promise.resolve({path:['system','status']})});
 const ok=await get(await session(repo,'support'));
 assert.equal(ok.status,200);
 const body=await ok.json() as {payment:string;manufacturer:string;physicalActions:boolean;manufacturerHealth:{status:string}};
 assert.equal(body.physicalActions,false,'the panel must report the physical lock as closed by default');
 assert.equal(body.payment,'mock');assert.equal(body.manufacturer,'not_configured');assert.equal(body.manufacturerHealth.status,'UNKNOWN');
 assert.equal((await get(await session(repo,'partner-demo'))).status,403);
 assert.equal((await get('x'.repeat(40))).status,401);
});
