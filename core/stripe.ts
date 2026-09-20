import {DomainError} from './providers';

export interface StripeIntent {id:string;status:string;amount:number;amount_received?:number;metadata?:Record<string,string>;}
export interface StripeRequest {method:'POST';path:string;body:Record<string,unknown>;idempotencyKey:string;}
export type StripeTransport=(request:StripeRequest)=>Promise<StripeIntent>;

/** Stripe TEST boundary. The transport is injected so tests never contact Stripe. */
export class StripePaymentProvider {
 constructor(private readonly secretKey:string,private readonly transport:StripeTransport=(request)=>defaultTransport(secretKey,request)){if(!secretKey||!secretKey.startsWith('sk_test_'))throw new DomainError('Stripe TEST nécessite une clé sk_test_.',503);}
 async authorize(rentalId:string,cents:number):Promise<StripeIntent>{if(!Number.isSafeInteger(cents)||cents<=0)throw new DomainError('Montant d’autorisation invalide.');return this.call('/payment_intents',{amount:cents,currency:'eur',capture_method:'manual',metadata:{rentalId,provider:'batyeo'}},`rental-${rentalId}-authorize`);}
 async capture(intentId:string,cents:number,rentalId:string):Promise<StripeIntent>{if(!Number.isSafeInteger(cents)||cents<0)throw new DomainError('Montant de capture invalide.');return this.call(`/payment_intents/${encodeURIComponent(intentId)}/capture`,{amount_to_capture:cents,metadata:{rentalId}},`rental-${rentalId}-capture-${cents}`);}
 /** Giving money back is the only correction available once a deposit is captured: a capture
  * cannot be undone, and without this an admin mistake or a battery found after a 48 h write-off
  * was final. Idempotency key includes the amount so a retry never doubles the refund. */
 async refund(intentId:string,cents:number,rentalId:string):Promise<StripeIntent>{if(!Number.isSafeInteger(cents)||cents<=0)throw new DomainError('Montant de remboursement invalide.');return this.call('/refunds',{payment_intent:intentId,amount:cents,metadata:{rentalId}},`rental-${rentalId}-refund-${cents}`);}
 async release(intentId:string,rentalId:string):Promise<StripeIntent>{return this.call(`/payment_intents/${encodeURIComponent(intentId)}/cancel`,{},`rental-${rentalId}-release`);}
 private call(path:string,body:Record<string,unknown>,idempotencyKey:string){return this.transport({method:'POST',path,body,idempotencyKey}).catch(error=>{if(error instanceof DomainError)throw error;throw new DomainError('Stripe est temporairement indisponible.',503);});}
}
async function defaultTransport(secretKey:string,request:StripeRequest):Promise<StripeIntent>{const encoded=new URLSearchParams();for(const [key,value] of Object.entries(request.body)){if(typeof value==='object'&&value!==null)for(const [nested,nestedValue] of Object.entries(value))encoded.set(`${key}[${nested}]`,String(nestedValue));else encoded.set(key,String(value));}const response=await fetch(`https://api.stripe.com/v1${request.path}`,{method:'POST',headers:{Authorization:`Bearer ${secretKey}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':request.idempotencyKey},body:encoded});const payload=await response.json() as StripeIntent & {error?:{message?:string}};if(!response.ok)throw new DomainError(payload.error?.message??'Stripe a refusé l’opération.',response.status===402?402:503);return payload;}

/**
 * A Terminal connection token is how the Stripe Terminal SDK running on the
 * station authenticates its card reader session — short-lived, requested
 * fresh per connection attempt, and never the account secret key itself. This
 * is the only Stripe call the kiosk's own process is allowed to trigger.
 */
export async function createTerminalConnectionToken(secretKey:string):Promise<{secret:string}>{
 if(!secretKey||!secretKey.startsWith('sk_test_'))throw new DomainError('Stripe TEST nécessite une clé sk_test_.',503);
 const response=await fetch('https://api.stripe.com/v1/terminal/connection_tokens',{method:'POST',headers:{Authorization:`Bearer ${secretKey}`,'Content-Type':'application/x-www-form-urlencoded'}});
 const payload=await response.json() as {secret?:string;error?:{message?:string}};
 if(!response.ok||!payload.secret)throw new DomainError(payload.error?.message??'Stripe a refusé la demande de jeton lecteur.',response.status===402?402:503);
 return {secret:payload.secret};
}
export interface TerminalLocation {id:string;displayName:string;line1:string;city:string;postalCode:string;country:string;state:string;}
interface StripeLocationPayload {id?:string;display_name?:string;address?:{line1?:string;city?:string;postal_code?:string;country?:string;state?:string};}
const mapTerminalLocation=(row:StripeLocationPayload):TerminalLocation=>({id:row.id??'',displayName:row.display_name??'',line1:row.address?.line1??'',city:row.address?.city??'',postalCode:row.address?.postal_code??'',country:row.address?.country??'',state:row.address?.state??''});
async function terminalRequest(secretKey:string,method:'GET'|'POST',path:string,body?:URLSearchParams):Promise<unknown>{
 if(!secretKey||!secretKey.startsWith('sk_test_'))throw new DomainError('Stripe TEST nécessite une clé sk_test_.',503);
 const response=await fetch(`https://api.stripe.com/v1${path}`,{method,headers:{Authorization:`Bearer ${secretKey}`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body});
 const payload=await response.json() as {error?:{message?:string}};
 if(!response.ok)throw new DomainError(payload.error?.message??'Stripe a refusé l’opération Terminal.',response.status===402?402:503);
 return payload;
}
/**
 * A Terminal Location is an ordinary object in the merchant's own Stripe account — the manufacturer
 * platform's own "create Stripe location" button is just this same public API call with the
 * merchant's key. Owning the call here is what lets BATYEO assign a reader Location without
 * depending on their dashboard at all. Country is required by Stripe and BATYEO stores no country
 * on a Venue, so the caller supplies it rather than having one guessed from the city.
 */
export async function createTerminalLocation(secretKey:string,input:{displayName:string;line1:string;city:string;country:string;postalCode?:string;state?:string}):Promise<TerminalLocation>{
 const country=input.country.trim().toUpperCase();if(!/^[A-Z]{2}$/.test(country))throw new DomainError('Code pays invalide (deux lettres attendues, ex. FR).',400);
 if(!input.displayName.trim())throw new DomainError('Nom de la Location requis.',400);
 const body=new URLSearchParams({display_name:input.displayName.trim(),'address[line1]':input.line1.trim(),'address[city]':input.city.trim(),'address[country]':country});
 if(input.postalCode?.trim())body.set('address[postal_code]',input.postalCode.trim());
 if(input.state?.trim())body.set('address[state]',input.state.trim());
 const payload=await terminalRequest(secretKey,'POST','/terminal/locations',body) as StripeLocationPayload;
 if(!payload.id)throw new DomainError('Stripe n’a pas renvoyé d’identifiant de Location.',503);
 return mapTerminalLocation(payload);
}
/** Lets an operator reuse a Location the account already has — including one created earlier from
 * the manufacturer's platform — instead of creating a duplicate for the same physical address. */
export async function listTerminalLocations(secretKey:string):Promise<TerminalLocation[]>{
 const payload=await terminalRequest(secretKey,'GET','/terminal/locations?limit=100') as {data?:StripeLocationPayload[]};
 return (payload.data??[]).filter(row=>row.id).map(mapTerminalLocation);
}
export async function verifyStripeSignature(payload:string,header:string,secret:string,now=Math.floor(Date.now()/1000),tolerance=300):Promise<boolean>{const parts=Object.fromEntries(header.split(',').map(part=>part.split('='))) as Record<string,string>;const timestamp=Number(parts.t);const signature=parts.v1;if(!Number.isFinite(timestamp)||!signature||Math.abs(now-timestamp)>tolerance)return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${payload}`));const expected=Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');if(expected.length!==signature.length)return false;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^signature.charCodeAt(i);return mismatch===0;}

export interface StripeWebhookEvent {id:string;type:string;created:number;data:{object:Record<string,unknown>};}
export type WebhookStatus='PROCESSED'|'FAILED';
/** Replace this ledger with the repository-backed WebhookEvent table in production. */
export class StripeWebhookLedger {private readonly events=new Map<string,{status:WebhookStatus;error?:string}>();async process(event:StripeWebhookEvent,handler:(event:StripeWebhookEvent)=>Promise<void>|void){const previous=this.events.get(event.id);if(previous?.status==='PROCESSED')return;if(previous?.status==='FAILED')this.events.delete(event.id);try{await handler(event);this.events.set(event.id,{status:'PROCESSED'});}catch(error){this.events.set(event.id,{status:'FAILED',error:error instanceof Error?error.message:'Unknown webhook error'});throw error;}}hasProcessed(id:string){return this.events.get(id)?.status==='PROCESSED';}}
