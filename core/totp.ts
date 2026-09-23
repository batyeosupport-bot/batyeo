/**
 * Time-based one-time codes (RFC 6238, the scheme Google Authenticator, Authy and 1Password read):
 * HMAC-SHA1 over the 30-second step counter, 6 digits. WebCrypto only, so it runs identically on
 * Vercel, in Workers and in tests.
 */
export const TOTP_STEP_SECONDS=30;
/** The portal matches on this exact text to reveal the code field — keep the two in sync. */
export const MFA_REQUIRED_MESSAGE='Entrez le code à 6 chiffres de votre application d’authentification.';
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes:Uint8Array):string{
 let bits=0,value=0,out='';
 for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}}
 if(bits>0)out+=ALPHABET[(value<<(5-bits))&31];
 return out;
}
export function base32Decode(text:string):Uint8Array{
 const clean=text.replace(/[\s=]/g,'').toUpperCase();let bits=0,value=0;const out:number[]=[];
 for(const char of clean){const index=ALPHABET.indexOf(char);if(index<0)throw new Error('Invalid base32 secret.');value=(value<<5)|index;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}
 return new Uint8Array(out);
}
export function generateTotpSecret():string{return base32Encode(crypto.getRandomValues(new Uint8Array(20)));}
export const totpStep=(now:number)=>Math.floor(now/1000/TOTP_STEP_SECONDS);

export async function totpCode(secret:string,step:number):Promise<string>{
 const counter=new Uint8Array(8);let rest=step;for(let i=7;i>=0;i--){counter[i]=rest&255;rest=Math.floor(rest/256);}
 const key=await crypto.subtle.importKey('raw',base32Decode(secret) as BufferSource,{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,counter as BufferSource));
 const offset=mac[mac.length-1]&15;
 const binary=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];
 return String(binary%1_000_000).padStart(6,'0');
}

/**
 * Accepts the current step and one on each side (a phone clock a few seconds off). Returns the step
 * that matched, or null. A step at or before `lastUsedStep` is refused: a code seen over a
 * shoulder, or replayed from a captured request, cannot be used a second time.
 */
export async function verifyTotp(secret:string,code:string,now:number,lastUsedStep:number|null=null):Promise<number|null>{
 if(!/^\d{6}$/.test(code))return null;
 const current=totpStep(now);
 for(const step of [current,current-1,current+1]){
  if(lastUsedStep!=null&&step<=lastUsedStep)continue;
  if(await totpCode(secret,step)===code)return step;
 }
 return null;
}

export function totpUri(secret:string,email:string):string{
 return `otpauth://totp/${encodeURIComponent('BATYEO:'+email)}?secret=${secret}&issuer=BATYEO&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}
