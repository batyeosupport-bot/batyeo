import {sha256,constantTimeEqual} from './security';
export interface EnrollmentToken {id:string;stationId:string;partnerId:string;digest:string;expiresAt:number;usedAt:number|null;createdAt:number;}
export interface RuntimeCredential {runtimeId:string;stationId:string;partnerId:string;digest:string;createdAt:number;lastUsedAt:number|null;revokedAt:number|null;version:number;}
/** Local/demo registry. Durable enrollment must use a repository transaction. */
export class RuntimeEnrollmentRegistry {
 private readonly tokens=new Map<string,EnrollmentToken>();
 private readonly credentials=new Map<string,RuntimeCredential>();
 async issue(stationId:string,partnerId:string,ttlMs=10*60_000,now=Date.now()){
  if(!stationId||!partnerId||!Number.isSafeInteger(ttlMs)||ttlMs<=0||ttlMs>10*60_000||!Number.isSafeInteger(now)||now<0)throw new Error('Invalid enrollment parameters.');
  const raw=crypto.randomUUID()+crypto.randomUUID();
  const token:EnrollmentToken={id:crypto.randomUUID(),stationId,partnerId,digest:await sha256(raw),expiresAt:now+ttlMs,usedAt:null,createdAt:now};
  this.tokens.set(token.id,token);return {tokenId:token.id,rawToken:raw,token:{...token}};
 }
 async enroll(tokenId:string,rawToken:string,runtimeId:string,deviceFingerprint:string,now=Date.now()){
  void deviceFingerprint;
  if(!runtimeId||runtimeId.length>100)throw new Error('Invalid runtime identifier.');
  const secret=crypto.randomUUID()+crypto.randomUUID();
  const [tokenDigest,credentialDigest]=await Promise.all([sha256(rawToken),sha256(secret)]);
  // All checks and mutations after hashing are synchronous: concurrent calls cannot consume twice.
  const token=this.tokens.get(tokenId),previous=this.credentials.get(runtimeId);
  if(!token||token.usedAt!==null||token.expiresAt<=now||!constantTimeEqual(tokenDigest,token.digest))throw new Error('Enrollment token invalid or expired.');
  if(previous&&previous.revokedAt===null)throw new Error('Runtime already enrolled.');
  if(previous&&(previous.stationId!==token.stationId||previous.partnerId!==token.partnerId))throw new Error('Runtime station scope rejected.');
  const credential:RuntimeCredential={runtimeId,stationId:token.stationId,partnerId:token.partnerId,digest:credentialDigest,createdAt:now,lastUsedAt:null,revokedAt:null,version:(previous?.version??0)+1};
  token.usedAt=now;this.credentials.set(runtimeId,credential);return {secret,credential:{...credential}};
 }
 async authenticate(runtimeId:string,secret:string,now=Date.now()){
  const digest=await sha256(secret);
  const c=this.credentials.get(runtimeId);
  if(!c||c.revokedAt!==null||!constantTimeEqual(digest,c.digest))throw new Error('Runtime credential rejected.');
  c.lastUsedAt=now;return {...c};
 }
 revoke(runtimeId:string,now=Date.now()){
  const c=this.credentials.get(runtimeId);if(!c||c.revokedAt!==null)return false;c.revokedAt=now;return true;
 }
 async rotate(runtimeId:string,now=Date.now()){
  const previous=this.credentials.get(runtimeId),version=previous?.version;
  const secret=crypto.randomUUID()+crypto.randomUUID(),digest=await sha256(secret);
  const c=this.credentials.get(runtimeId);
  if(!c||c!==previous||c.revokedAt!==null||c.version!==version)throw new Error('Runtime credential unavailable or changed.');
  c.digest=digest;c.version++;c.createdAt=now;c.lastUsedAt=null;return {secret,credential:{...c}};
 }
}
