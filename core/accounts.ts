import type {Actor,Data,Role,User} from './types';
import {DomainError} from './providers';

export const MIN_PASSWORD_LENGTH=10;
export const TEAM_ROLES=['PARTNER_ADMIN','PARTNER_USER'] as const;
export interface TeamMember {id:string;name:string;email:string;role:Role;partnerId:string|null;disabledAt:number|null;}

const canManageTeam=(actor:Actor)=>['SUPER_ADMIN','ADMIN','PARTNER_ADMIN'].includes(actor.role);
const view=(u:User):TeamMember=>({id:u.id,name:u.name,email:u.email,role:u.role,partnerId:u.partnerId,disabledAt:u.disabledAt??null});

/** Accounts the actor may administer: every login for BATYEO staff, only their own partner's for a PARTNER_ADMIN. Never includes password hashes. */
export function teamFor(d:Data,actor:Actor):TeamMember[]{
 if(!canManageTeam(actor))return [];
 return d.users.filter(u=>actor.role==='PARTNER_ADMIN'?u.partnerId===actor.partnerId:true).map(view).sort((a,b)=>a.email.localeCompare(b.email));
}

function managed(d:Data,actor:Actor,userId:string):User{
 if(!canManageTeam(actor))throw new DomainError('Accès non autorisé.',403);
 const target=d.users.find(u=>u.id===userId);
 if(!target||(actor.role==='PARTNER_ADMIN'&&target.partnerId!==actor.partnerId))throw new DomainError('Compte introuvable.',404);
 if(target.id===actor.id)throw new DomainError('Pour votre propre compte, utilisez la page Paramètres.',403);
 if(actor.role==='ADMIN'&&target.role==='SUPER_ADMIN')throw new DomainError('Un administrateur ne peut pas modifier un super administrateur.',403);
 return target;
}

export interface CreateTeamMemberInput {name:string;email:string;role:typeof TEAM_ROLES[number];partnerId?:string;}
/** Adds a login to an existing partner. passwordHash is the hash of a one-time temporary secret the caller shows once. */
export function createTeamMember(d:Data,actor:Actor,input:CreateTeamMemberInput,passwordHash:string):User{
 if(!canManageTeam(actor))throw new DomainError('Accès non autorisé.',403);
 const partnerId=actor.role==='PARTNER_ADMIN'?actor.partnerId:input.partnerId??null;
 if(!partnerId||!d.partners.some(p=>p.id===partnerId))throw new DomainError('Partenaire introuvable.',404);
 const email=input.email.trim().toLowerCase();
 if(d.users.some(u=>u.email.toLowerCase()===email))throw new DomainError('Cet email est déjà utilisé.',409);
 const user:User={id:crypto.randomUUID(),email,name:input.name.trim(),role:input.role,partnerId,passwordHash,authVersion:0};
 d.users.push(user);d.partnerUsers.push({id:crypto.randomUUID(),userId:user.id,partnerId});
 return user;
}

/** Disabling takes effect on the very next request (actorForUser refuses a disabled user) and drops the user's stored sessions. */
export function setUserDisabled(d:Data,actor:Actor,userId:string,disabled:boolean,now=Date.now()):User{
 const target=managed(d,actor,userId);
 target.disabledAt=disabled?now:null;
 if(disabled)d.sessions=d.sessions.filter(s=>s.userId!==target.id);
 return target;
}

/** Replaces the password and invalidates every session of that user (authVersion bump), so a leaked old password stops working everywhere at once. */
export function resetUserPassword(d:Data,actor:Actor,userId:string,passwordHash:string):User{
 const target=managed(d,actor,userId);
 target.passwordHash=passwordHash;target.authVersion=(target.authVersion??0)+1;
 d.sessions=d.sessions.filter(s=>s.userId!==target.id);
 return target;
}

/** Self-service change. Every other session of the same user is dropped; the one making the change stays valid. */
export function applyOwnPassword(d:Data,userId:string,expectedHash:string,newHash:string,keepSessionDigest:string):void{
 const user=d.users.find(u=>u.id===userId);
 if(!user||user.passwordHash!==expectedHash)throw new DomainError('Le mot de passe a changé entre-temps. Réessayez.',409);
 user.passwordHash=newHash;user.authVersion=(user.authVersion??0)+1;
 d.sessions=d.sessions.filter(s=>s.userId!==user.id||s.id===keepSessionDigest);
 const current=d.sessions.find(s=>s.id===keepSessionDigest);if(current)current.authVersion=user.authVersion;
}
