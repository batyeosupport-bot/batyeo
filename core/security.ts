import type {Actor,Data,User} from './types';
import {DomainError} from './providers';
export const SESSION_LIFETIME_MS=8*3_600_000;
export const CUSTOMER_LIFETIME_MS=7*86_400_000;
/** A handoff link (web → mobile deep link) is not a session: it must be worthless within minutes. */
export const CUSTOMER_HANDOFF_LIFETIME_MS=5*60_000;
const ITERATIONS=100_000; // Worker WebCrypto ceiling; versioned for future upgrades.
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function sha256(value:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function hashPassword(password:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:ITERATIONS,hash:'SHA-256'},key,256));}
export async function createPasswordHash(password:string){const salt=crypto.randomUUID();return `pbkdf2-sha256$${ITERATIONS}$${salt}$${await hashPassword(password,salt)}`;}
export function constantTimeEqual(a:string,b:string){let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
export async function verifyPassword(password:string,encoded:string,allowLegacy=false){
 const [algorithm,iterations,salt,digest]=encoded.split('$');
 if(algorithm==='pbkdf2-sha256'&&iterations===String(ITERATIONS)&&salt&&digest)return constantTimeEqual(await hashPassword(password,salt),digest);
 if(allowLegacy&&/^[a-f0-9]{64}$/.test(encoded))return constantTimeEqual(await hashPassword(password,'batyeo-demo-v1'),encoded);
 // Burn the same KDF on unknown users or malformed hashes to avoid a cheap enumeration path.
 await hashPassword(password,'batyeo-invalid-user');return false;
}
export function cookie(request:Request,name:string){const value=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value&&/^[a-zA-Z0-9-]{32,128}$/.test(value)?value:undefined;}
export function customerToken(request:Request){const token=cookie(request,'batyeo_customer')??request.headers.get('x-batyeo-customer-token')??undefined;return token&&/^[a-zA-Z0-9-]{32,128}$/.test(token)?token:undefined;}
export function setCookie(request:Request,name:string,value:string,maxAge=86400){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function actorForUser(d:Data,u:User):Actor|undefined {
 if(u.disabledAt!=null)return;
 if(u.role.startsWith('PARTNER_')){
  if(!u.partnerId||!d.partnerUsers.some(m=>m.userId===u.id&&m.partnerId===u.partnerId)||!d.partners.some(p=>p.id===u.partnerId))return;
 }else if(u.partnerId!==null)return; // Fail closed on corrupt staff/tenant assignments.
 return {id:u.id,role:u.role,partnerId:u.partnerId};
}
export function actorForDigest(digest:string|undefined,d:Data,now=Date.now()):Actor|undefined {
 const s=d.sessions.find(s=>s.id===digest&&s.expiresAt>now);if(!s)return;
 const u=d.users.find(u=>u.id===s.userId);if(!u||(u.authVersion??0)!==(s.authVersion??0))return;
 return actorForUser(d,u);
}
export async function actorFor(request:Request,d:Data){const token=cookie(request,'batyeo_session');return actorForDigest(token?await sha256(token):undefined,d);}
/** Resolves a session token digest to the customer's stable identity — never the digest itself, so a session can be rotated (handoff) without changing who owns a rental. */
export function requireCustomer(d:Data,digest:string,now=Date.now()):string{
 const session=d.customerSessions.find(s=>s.id===digest&&s.expiresAt>now);
 if(!session)throw new DomainError('Votre session a expiré. Rechargez la page avant de continuer.',401);
 return session.customerId;
}
export function rateLimit(d:Data,key:string,max:number,now=Date.now()){d.limits=d.limits.filter(x=>x.expiresAt>now);let entry=d.limits.find(x=>x.id===key);if(!entry){entry={id:key,count:0,expiresAt:now+60_000};d.limits.push(entry);}if(entry.count>=max)throw new DomainError('Trop de tentatives. Réessayez dans une minute.',429);entry.count++;}
export function verifyOrigin(request:Request){
 const origin=request.headers.get('origin');
 // Native clients do not send a browser Origin. They must identify themselves
 // explicitly; browser requests still require a same-origin check.
 if(origin){if(origin!==new URL(request.url).origin)throw new DomainError('Origine de requête refusée.',403);}
 else if(request.headers.get('x-batyeo-client')!=='mobile')throw new DomainError('Origine de requête refusée.',403);
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new DomainError('Format de requête invalide.',415);
}
