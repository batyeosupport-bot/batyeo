import type {CustomerPublicResponse,CustomerRentalSnapshot,CustomerStationSnapshot} from '../contracts/customer-api';
export type Rental = CustomerRentalSnapshot;
export type Station = CustomerStationSnapshot;
export type Network = typeof fetch;
export type Storage = {get():Promise<string|null>;set(value:string):Promise<void>};
export class ApiError extends Error {constructor(message:string,readonly status=0){super(message);}}
export function validateCoreUrl(value:string):string {
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash)throw new Error('Adresse API invalide.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','10.0.2.2'].includes(url.hostname)))throw new Error('L’API BATYEO doit utiliser HTTPS.');
 return value.replace(/\/$/,'');
}
export function stationIdFromLink(value:string,origin:string):string|null {
 try{const url=new URL(value);if(url.protocol==='batyeo:'&&url.host==='rent'&&/^\/[a-z0-9-]{3,80}$/i.test(url.pathname)&&!url.search)return url.pathname.slice(1);
 if(url.origin!==new URL(origin).origin||url.search||url.hash)return null;
 return url.pathname.match(/^\/rent\/([a-z0-9-]{3,80})$/i)?.[1]??null;}catch{return null;}
}
/** One shared session promise and one mutation at a time, including synchronous double taps. */
export class MobileClient {
 private session:Promise<string>|null=null;
 private mutation:Promise<{rental:Rental}>|null=null;
 private pending:{station:string;key:string;kind:string}|null=null;
 constructor(private base:string,private storage:Storage,private uuid:()=>string,private network:Network=fetch,private web=false){}
 async request<T>(path:string,body?:unknown,token?:string):Promise<T>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await this.network(`${this.base}/${path}`,{method:body===undefined?'GET':'POST',credentials:this.web?'include':'omit',signal:controller.signal,headers:{'Content-Type':'application/json',...(!this.web?{'x-batyeo-client':'mobile'}:{}),...(token?{'x-batyeo-customer-token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   if(!(response.headers.get('content-type')??'').includes('application/json'))throw new ApiError('API inaccessible. Vérifiez son adresse et son accès.',response.status);
   const data=await response.json();if(!response.ok)throw new ApiError(typeof data==='object'&&data!==null&&'error' in data&&typeof data.error==='string'?data.error:'Service momentanément indisponible.',response.status);return data as T;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError('Connexion interrompue. Réessayez pour retrouver votre location.');}finally{clearTimeout(timer);}
 }
 async token():Promise<string>{
  if(this.web)return '';
  if(!this.session)this.session=(async()=>{const saved=await this.storage.get();if(saved)return saved;const data=await this.request<{sessionToken:string}>('customer/session',{});await this.storage.set(data.sessionToken);return data.sessionToken;})().catch(error=>{this.session=null;throw error;});
  return this.session;
 }
 async current(){return this.request<{rental:Rental|null;serverTime:number}>('customer',undefined,await this.token());}
 async history(){return this.request<{rentals:Rental[]}>('customer/history',undefined,await this.token());}
 async stations(){return this.request<CustomerPublicResponse>('public');}
 async claim(token:string){const data=await this.request<{sessionToken:string}>('customer/claim',{handoffToken:token});if(!this.web){await this.storage.set(data.sessionToken);this.session=Promise.resolve(data.sessionToken);}return this.current();}
 async ticket(email:string,subject:string,message:string,rentalId?:string){return this.request<{id:string}>('ticket',{email,subject,message,...(rentalId?{rentalId}:{})},await this.token());}
 action(kind:'start'|'customer/return',station:string):Promise<{rental:Rental}>{
  if(this.mutation)return this.mutation;
  this.mutation=(async()=>{
   const current=await this.current();
   if(kind==='start'&&current.rental&&['CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','OVERDUE','RETURN_PENDING','RETURNED','ERROR'].includes(current.rental.state))return {rental:current.rental};
   if(kind==='customer/return'&&current.rental?.state==='COMPLETED')return {rental:current.rental};
   if(this.pending&&(this.pending.kind!==kind||this.pending.station!==station))throw new ApiError('Vérifiez d’abord la location en cours avant de changer de station.');
   this.pending??={kind,station,key:this.uuid()};
   const result=await this.request<{rental:Rental}>(kind,{stationPublicId:station,idempotencyKey:this.pending.key,...(kind==='start'?{termsAccepted:true}:{})},await this.token());
   this.pending=null;return result;
  })().finally(()=>{this.mutation=null;});return this.mutation;
 }
}
