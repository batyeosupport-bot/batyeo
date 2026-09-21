import {DomainError} from './providers';

export interface MailMessage {to:string;subject:string;text:string;}
export interface Mailer {send(message:MailMessage):Promise<void>;}
export interface MailConfig {mailer:Mailer;opsEmail:string|null;}
type FetchLike=(url:string,init:{method:string;headers:Record<string,string>;body:string;signal?:AbortSignal})=>Promise<{ok:boolean;status:number}>;

/**
 * Resend over plain HTTPS: one endpoint, no SDK, no extra dependency. It is only one implementation
 * of `Mailer` — swapping provider means writing another class, nothing else in the project knows
 * who delivers the mail. The API key is never placed in an error message or a log line.
 */
export class ResendMailer implements Mailer {
 constructor(private readonly apiKey:string,private readonly from:string,private readonly fetchImpl:FetchLike=(url,init)=>fetch(url,init)){}
 async send(message:MailMessage):Promise<void>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
  try{
   const response=await this.fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:this.from,to:[message.to],subject:message.subject,text:message.text}),signal:controller.signal});
   if(!response.ok)throw new DomainError(`Envoi d’email refusé par le prestataire (HTTP ${response.status}).`,502);
  }catch(error){
   if(error instanceof DomainError)throw error;
   throw new DomainError('Envoi d’email impossible (prestataire injoignable).',502);
  }finally{clearTimeout(timer);}
 }
}

/**
 * Email is entirely optional, and all-or-nothing: a half-configured sender (a key with no From
 * address, or an ops address with no sender behind it) fails at startup instead of silently never
 * mailing anyone. When it is off, the product must not promise a message it can never send — see
 * `emailEnabled` on the public API, which the rental page uses to decide whether to ask for an address.
 */
export function resolveMailer(env:Record<string,string|undefined>,fetchImpl?:FetchLike):MailConfig|undefined{
 const key=env.RESEND_API_KEY?.trim(),from=env.MAIL_FROM?.trim(),ops=env.OPS_ALERT_EMAIL?.trim();
 if(!key&&!from){
  if(ops)throw new DomainError('OPS_ALERT_EMAIL nécessite RESEND_API_KEY et MAIL_FROM.',503);
  return undefined;
 }
 if(!key||!from)throw new DomainError('RESEND_API_KEY et MAIL_FROM doivent être définis ensemble.',503);
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$|^.+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(from))throw new DomainError('MAIL_FROM n’est pas une adresse valide.',503);
 if(ops&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ops))throw new DomainError('OPS_ALERT_EMAIL n’est pas une adresse valide.',503);
 return {mailer:new ResendMailer(key,from,fetchImpl),opsEmail:ops||null};
}
