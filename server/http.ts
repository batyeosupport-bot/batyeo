import {constantTimeEqual} from '../core/security';
import {authorizeRuntime} from '../core/runtime-access';
import {z,ZodError} from 'zod';
import type {Repository} from '../core/repository';
import {actorFor,actorForDigest,actorForUser,cookie,customerToken,setCookie,sha256,createPasswordHash,verifyPassword,rateLimit,verifyOrigin,requireCustomer,SESSION_LIFETIME_MS,CUSTOMER_LIFETIME_MS,CUSTOMER_HANDOFF_LIFETIME_MS} from '../core/security';
import {RentalEngine,authorize,assertTenant,OPEN_STATES,overdueLossEligible} from '../core/rental';
import {DomainError,MockBatteryStationProvider} from '../core/providers';
import {verifyStripeSignature,StripePaymentProvider,createTerminalConnectionToken,createTerminalLocation,listTerminalLocations} from '../core/stripe';
import {StripeRentalCoordinator,type AsyncBatteryEjector} from '../core/stripe-coordinator';
import {resolvePaymentMode,type PaymentMode} from '../core/payment-mode';
import {ManufacturerBatteryEjector,ManufacturerBatteryStationProvider,ManufacturerHttpClient,reconcileManufacturerStation,resolveManufacturerConfig,validateManufacturerStartup} from '../core/manufacturer';
import {ManufacturerSyncService,linkManufacturerStation} from '../core/manufacturer-sync';
import {providerHealth} from '../core/manufacturer-sync';
import {dashboard,rentalView,customerRentalView,stationViews,stationDisplaySnapshot,displayConfigFor,canViewFinance} from '../core/queries';
import {checksumConfig} from '../core/runtime-config';
import {heartbeatHealth} from '../core/heartbeat';
import {validateTranslations} from '../core/i18n';
import type {Actor,Data,StationHeartbeatRecord} from '../core/types';
import {createStation,createVenue,updateVenue,publicQrUrl,setStripeTerminalLocation,blockStationRentals,unblockStationRentals,archiveStation,restoreStation,relocateStation,setPartnerCommission,createPartner} from '../core/station-admin';
import {createMedia,setMediaStatus} from '../core/media-admin';
import {COMMISSION_TIERS_BPS} from '../core/pricing';
import {handleUpload,type HandleUploadBody} from '@vercel/blob/client';
/** Media kinds accepted for the admin upload button, mapped to what Vercel Blob will actually accept for that kind. */
const MEDIA_UPLOAD_LIMITS={IMAGE:{types:['image/jpeg','image/png','image/webp','image/gif'],maxBytes:15*1024*1024},VIDEO:{types:['video/mp4','video/webm','video/quicktime'],maxBytes:150*1024*1024}} as const;

const engine=new RentalEngine();
const station=new MockBatteryStationProvider();
const id=z.string().min(1).max(100);
/** Telemetry a station runtime reports; `stationId`/`runtimeId`/`at` are taken from the credential and the server clock, never from the body. */
const heartbeatSchema=z.object({runtimeVersion:z.string().min(1).max(50),configVersion:z.number().int().nonnegative().optional(),network:z.enum(['ONLINE','OFFLINE','DEGRADED']),appUptimeMs:z.number().int().nonnegative(),displayStatus:z.enum(['OK','ERROR','MAINTENANCE']),providerStatus:z.string().max(50).nullable(),lastCoreContactAt:z.number().int().nonnegative().nullable(),freeStorageBytes:z.number().int().nonnegative().nullable().optional(),localErrorCount:z.number().int().nonnegative().optional(),applicationHealth:z.enum(['OK','DEGRADED','ERROR']).optional(),errors:z.array(z.string().max(500)).max(20)});
const reply=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function audit(d:Data,a:Actor,action:string){d.audits.push({id:crypto.randomUUID(),userId:a.id,action,at:Date.now()});}
export function createApi(repository:Repository,options:{demo:boolean;allowLegacyCredentials:boolean},dependencies:{stripeProvider?:Pick<StripePaymentProvider,'authorize'|'capture'|'release'>;manufacturerProvider?:Pick<ManufacturerBatteryStationProvider,'getDeviceInfo'|'listDevices'>;batteryEjector?:AsyncBatteryEjector;handleMediaUpload?:typeof handleUpload}={}) {
 // A bad deployment config (a malformed key, an inconsistent flag combination) must surface as the
 // same clean {error, status} JSON as any other DomainError, not as an opaque empty 500: this used
 // to throw straight out of createApi(), before handle()'s try/catch even exists to catch it —
 // confirmed live on 2026-09-19 when a misconfigured STRIPE_SECRET_KEY produced exactly that empty
 // response instead of the "Stripe TEST nécessite STRIPE_SECRET_KEY." message it was throwing.
 let paymentMode:PaymentMode,manufacturerProvider:Pick<ManufacturerBatteryStationProvider,'getDeviceInfo'|'listDevices'>|undefined,manufacturerSync:ManufacturerSyncService|undefined,batteryEjector:AsyncBatteryEjector|undefined,stripeCoordinator:StripeRentalCoordinator|undefined;
 let startupError:unknown;
 try {
  const runtimeEnv=typeof process!=='undefined'?process.env:{};paymentMode=resolvePaymentMode(runtimeEnv);validateManufacturerStartup(runtimeEnv);
  const manufacturerConfig=resolveManufacturerConfig(runtimeEnv);const manufacturerClient=manufacturerConfig?new ManufacturerHttpClient(manufacturerConfig):undefined;
  manufacturerProvider=dependencies.manufacturerProvider??(manufacturerClient?new ManufacturerBatteryStationProvider(manufacturerClient):undefined);
  manufacturerSync=manufacturerProvider?new ManufacturerSyncService(repository,manufacturerProvider):undefined;
  // Only ever constructed on an explicit opt-in that validateManufacturerStartup has already found
  // coherent; without it the coordinator keeps its mock path and no rental can move real hardware.
  batteryEjector=dependencies.batteryEjector??(manufacturerClient&&manufacturerConfig?.allowPhysicalActions?new ManufacturerBatteryEjector(manufacturerClient,repository):undefined);
  stripeCoordinator=paymentMode==='stripe_test'?new StripeRentalCoordinator(dependencies.stripeProvider??new StripePaymentProvider(process.env.STRIPE_SECRET_KEY!),station,batteryEjector):undefined;
 } catch(e) { startupError=e; }
async function route(request:Request,path:string){
 if(startupError)throw startupError;
 if(request.method==='POST'&&path==='internal/manufacturer/sync'){
  const expected=typeof process!=='undefined'?process.env.MANUFACTURER_SYNC_SECRET:undefined,provided=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!expected||!provided||(await sha256(expected))!==(await sha256(provided)))throw new DomainError('Job de synchronisation non autorisé.',401);if(!manufacturerSync)throw new DomainError('Provider fabricant non configuré.',503);return reply({run:await manufacturerSync.run({trigger:'SCHEDULED'})});
 }
 if(request.method==='POST'&&path==='internal/rentals/capture-overdue-losses'){
  const expected=typeof process!=='undefined'?process.env.OVERDUE_CAPTURE_SECRET:undefined,provided=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!expected||!provided||(await sha256(expected))!==(await sha256(provided)))throw new DomainError('Job de capture non autorisé.',401);
  const now=Date.now();await repository.transaction(d=>engine.refreshOverdue(d,now));
  const candidates=(await repository.read()).rentals.filter(r=>overdueLossEligible(r,now));
  const results:{rentalId:string;status:'captured'|'failed';error?:string}[]=[];
  for(const candidate of candidates){
   try{if(stripeCoordinator)await stripeCoordinator.captureOverdueLoss(repository,candidate.id,now);else await repository.transaction(d=>engine.markDepositLost(d,candidate.id,candidate.pricing.depositCents,undefined,now));results.push({rentalId:candidate.id,status:'captured'});}
   catch(error){results.push({rentalId:candidate.id,status:'failed',error:error instanceof Error?error.message:'unknown'});}
  }
  return reply({processed:results.length,results});
 }
 if(request.method==='POST'&&path==='stripe/webhook'){
  const raw=await request.text();if(raw.length>256_000)throw new DomainError('Webhook trop volumineux.',413);
  const secret=typeof process!=='undefined'?process.env.STRIPE_WEBHOOK_SECRET:undefined;const signature=request.headers.get('stripe-signature');if(!secret||!signature)throw new DomainError('Webhook Stripe non configuré.',503);if(!(await verifyStripeSignature(raw,signature,secret)))throw new DomainError('Signature Stripe invalide.',400);
  let payload:unknown;try{payload=JSON.parse(raw);}catch{throw new DomainError('Payload Stripe invalide.',400);}
  const event=z.object({id:z.string().min(1).max(255),type:z.string().min(1).max(150),created:z.number().int(),data:z.object({object:z.record(z.unknown())}).passthrough()}).passthrough().parse(payload);const payloadHash=await sha256(raw);
  const existing=await repository.read();const previous=existing.webhookEvents.find(e=>e.source==='stripe'&&e.externalId===event.id);if(previous?.status==='PROCESSED')return reply({received:true,duplicate:true});
  await repository.transaction(d=>{const current=d.webhookEvents.find(e=>e.source==='stripe'&&e.externalId===event.id);if(current){current.status='RECEIVED';current.error=null;current.processedAt=null;}else d.webhookEvents.push({id:crypto.randomUUID(),source:'stripe',externalId:event.id,payloadHash,payload:event,receivedAt:Date.now(),processedAt:null,status:'RECEIVED',error:null});});
  try {if(stripeCoordinator)await stripeCoordinator.applyWebhook(repository,event);await repository.transaction(d=>{const current=d.webhookEvents.find(e=>e.source==='stripe'&&e.externalId===event.id);if(current){current.status='PROCESSED';current.processedAt=Date.now();current.error=null;}});return reply({received:true,duplicate:Boolean(previous)});}
  catch(error){await repository.transaction(d=>{const current=d.webhookEvents.find(e=>e.source==='stripe'&&e.externalId===event.id);if(current){current.status='FAILED';current.error=error instanceof Error?error.message:'Webhook processing failed';}});throw error;}
 }
 if(request.method==='POST'&&path==='manufacturer/webhook'){
  const raw=await request.text();if(raw.length>256_000)throw new DomainError('Webhook trop volumineux.',413);let payload:unknown;try{payload=JSON.parse(raw);}catch{throw new DomainError('Payload fabricant invalide.',400);}z.record(z.unknown()).parse(payload);
  const payloadHash=await sha256(raw),source='manufacturer:bajie',ip=request.headers.get('cf-connecting-ip')??'local';const inserted=await repository.transaction(d=>{rateLimit(d,`manufacturer-webhook-${ip}`,120);if(d.webhookEvents.some(event=>event.source===source&&event.externalId===payloadHash))return false;d.webhookEvents.push({id:crypto.randomUUID(),source,externalId:payloadHash,payloadHash,payload,receivedAt:Date.now(),processedAt:null,status:'UNTRUSTED',error:'Aucune signature fabricant officielle confirmée.'});return true;});if(!inserted)return reply({received:true,duplicate:true,trusted:false},202);
  if(!manufacturerSync)return reply({received:true,duplicate:false,trusted:false,reconciliation:'not_configured'},202);
  const linked=(await repository.read()).stationProviderLinks.some(link=>link.active);if(!linked)return reply({received:true,duplicate:false,trusted:false,reconciliation:'no_linked_station'},202);
  const run=await manufacturerSync.run({trigger:'WEBHOOK'});await repository.transaction(d=>{const event=d.webhookEvents.find(row=>row.source===source&&row.externalId===payloadHash);if(event){event.status=run.status==='FAILED'?'FAILED':'PROCESSED';event.processedAt=Date.now();event.error=run.status==='FAILED'?'La vérification read-only fabricant a échoué.':null;}});return reply({received:true,duplicate:false,trusted:false,reconciliation:run.status},202);
 }
 if(path.startsWith('runtime/')&&['runtime/station','runtime/config','runtime/heartbeat','runtime/terminal-connection-token'].includes(path)){
  const runtimeId=request.headers.get('x-batyeo-runtime-id');
  const bearer=request.headers.get('authorization')?.match(/^Bearer ([a-zA-Z0-9-]{32,128})$/)?.[1];
  if(!runtimeId||!bearer)throw new DomainError('Credential runtime requis.',401);
  const digest=await sha256(bearer),data=await repository.read();
  const credential=data.runtimeCredentials.find(c=>c.runtimeId===runtimeId);
  if(!credential||credential.revokedAt!==null||!constantTimeEqual(credential.digest,digest))throw new DomainError('Credential runtime refusé.',401);
  const requested=new URL(request.url).searchParams.get('stationId')??credential.stationId;
  if(requested!==credential.stationId)throw new DomainError('Accès station refusé.',403);
  if(!data.stations.some(st=>st.id===requested&&st.partnerId===credential.partnerId))throw new DomainError('Station indisponible.',409);
  if(request.method==='GET'&&path==='runtime/station'){
   authorizeRuntime(credential,'station/read',requested);
   return reply({runtimeId,credentialVersion:credential.version,station:stationDisplaySnapshot(data,requested),serverTime:Date.now()});
  }
  if(request.method==='GET'&&path==='runtime/config'){
   authorizeRuntime(credential,'config/read',requested);
   const config=displayConfigFor(data,requested);
   // The runtime validates this checksum before applying, and keeps its
   // last-known-good config when a payload arrives corrupted or truncated.
   return reply({runtimeId,credentialVersion:credential.version,envelope:{config,checksum:checksumConfig(config),issuedAt:Date.now()},serverTime:Date.now()});
  }
  if(request.method==='POST'&&path==='runtime/heartbeat'){
   authorizeRuntime(credential,'heartbeat/write',requested);
   const body=heartbeatSchema.parse(await request.json());
   const heartbeat:StationHeartbeatRecord={...body,id:`heartbeat-${requested}`,stationId:requested,runtimeId,at:Date.now()};
   await repository.transaction(d=>{
    const index=d.stationHeartbeats.findIndex(row=>row.stationId===requested);
    if(index>=0)d.stationHeartbeats[index]=heartbeat;else d.stationHeartbeats.push(heartbeat);
   });
   return reply({accepted:true,health:heartbeatHealth(heartbeat),configVersion:displayConfigFor(data,requested).version,serverTime:Date.now()});
  }
  if(request.method==='POST'&&path==='runtime/terminal-connection-token'){
   authorizeRuntime(credential,'payment/connect',requested);
   if(paymentMode!=='stripe_test')throw new DomainError('Stripe Terminal non configuré sur ce serveur.',503);
   const {secret}=await createTerminalConnectionToken(process.env.STRIPE_SECRET_KEY!);
   return reply({secret});
  }
  throw new DomainError('Route runtime inconnue.',404);
 }
 if(request.method==='GET'){
  const d=await repository.read();const actor=await actorFor(request,d);
  if(path==='health')return reply({status:'ok',demo:options.demo,providers:{payment:paymentMode,station:'mock',manufacturer:manufacturerProvider?'read_only':'not_configured'},manufacturerHealth:providerHealth(d),serverTime:Date.now()});
  if(path==='public')return reply({stations:stationViews(d).filter(s=>!s.archivedAt),pricing:d.pricing[0],demo:options.demo});
  if(path.startsWith('translations/')){
   const config=displayConfigFor(d,path.split('/')[1]);
   return reply({locale:config.locale,translations:config.translations});
  }
  if(path==='me')return reply({user:actor?{...actor,name:d.users.find(u=>u.id===actor.id)?.name}:null});
  if(path==='customer'){
   const existing=customerToken(request);
   const existingDigest=existing?await sha256(existing):undefined;
   const session=existingDigest?d.customerSessions.find(s=>s.id===existingDigest&&s.expiresAt>Date.now()):undefined;
   // Keep the existing preview's anonymous bearer recovery; migrate on first read only.
   const legacy=options.demo&&existingDigest&&!session&&d.rentals.some(r=>r.customerId===existingDigest);
   const reuse=!!existing&&!!(session||legacy);
   const token=reuse?existing!:crypto.randomUUID()+crypto.randomUUID();
   const digest=reuse?existingDigest!:await sha256(token);
   const customerId=session?session.customerId:legacy?existingDigest!:crypto.randomUUID();
   if(!session||d.rentals.some(r=>r.customerId===customerId&&r.state==='ACTIVE'&&r.deadline!==null&&Date.now()+r.simulatedMinutes*60000>r.deadline)){
    await repository.transaction(next=>{
     if(!next.customerSessions.some(s=>s.id===digest))next.customerSessions.push({id:digest,customerId,expiresAt:Date.now()+CUSTOMER_LIFETIME_MS});
     engine.refreshOverdue(next);
    });
   }
   const fresh=await repository.read();
   const rs=fresh.rentals.filter(r=>r.customerId===customerId).sort((a,b)=>b.createdAt-a.createdAt);
   const current=rs.find(r=>OPEN_STATES.includes(r.state))??rs[0];
   return reply({rental:current?customerRentalView(fresh,current):null,serverTime:Date.now()},200,token===existing?{}:{'Set-Cookie':setCookie(request,'batyeo_customer',token,CUSTOMER_LIFETIME_MS/1000)});
  }
  if(path==='customer/history'){
   const token=customerToken(request);if(!token)throw new DomainError('Session client manquante.',401);const customerId=requireCustomer(d,await sha256(token));return reply({rentals:d.rentals.filter(r=>r.customerId===customerId).sort((a,b)=>b.createdAt-a.createdAt).map(r=>customerRentalView(d,r)),serverTime:Date.now()});
  }
  if(path==='dashboard'){authorize(actor,'read');if(d.rentals.some(r=>r.state==='ACTIVE'&&r.deadline!==null&&Date.now()+r.simulatedMinutes*60000>r.deadline)){await repository.transaction(next=>engine.refreshOverdue(next));return reply(dashboard(await repository.read(),actor!));}return reply(dashboard(d,actor!));}
  if(path==='manufacturer/stations'){authorize(actor,'operate');if(!manufacturerProvider)throw new DomainError('Provider fabricant non configuré.',503);const search=new URL(request.url).searchParams;const query=z.object({coordType:z.string().min(1).max(30),zoomLevel:z.coerce.number().int(),lat:z.coerce.number().finite(),lng:z.coerce.number().finite(),showPrice:z.enum(['true','false']).transform(value=>value==='true')}).parse(Object.fromEntries(search));return reply({stations:await manufacturerProvider.listDevices(query)});}
  // Read of the merchant's own Stripe account, so an operator can reuse a Location it already has
  // — including one created earlier from the manufacturer's platform — instead of duplicating it.
  if(path==='stripe/terminal-locations'){authorize(actor,'settings');if(paymentMode!=='stripe_test')throw new DomainError('Stripe TEST n’est pas configuré sur ce serveur.',503);return reply({locations:await listTerminalLocations(process.env.STRIPE_SECRET_KEY!)});}
  if(path.startsWith('manufacturer/stations/')){authorize(actor,'read');if(!manufacturerProvider)throw new DomainError('Provider fabricant non configuré.',503);const local=d.stations.find(s=>s.id===path.split('/')[2]||s.publicId===path.split('/')[2]);if(!local)throw new DomainError('Station introuvable.',404);assertTenant(actor!,local.partnerId);const link=d.stationProviderLinks.find(row=>row.stationId===local.id&&row.active),externalId=link?.externalId??local.providerDeviceId;if(!externalId)throw new DomainError('Identifiant fabricant non configuré pour cette station.',409);const snapshot=await manufacturerProvider.getDeviceInfo(externalId);return reply({station:snapshot,differences:reconcileManufacturerStation(d,local,snapshot)});}
  if(path.startsWith('rentals/')){
   authorize(actor,'read');const r=d.rentals.find(r=>r.id===path.split('/')[1]);if(!r)throw new DomainError('Location introuvable.',404);assertTenant(actor!,r.partnerId);return reply(rentalView(d,r,canViewFinance(actor!)));
  }
  throw new DomainError('Ressource introuvable.',404);
 }
 verifyOrigin(request);
 const raw=await request.text();if(raw.length>16_384)throw new DomainError('Requête trop volumineuse.',413);
 let body:unknown;try{body=JSON.parse(raw);}catch{throw new DomainError('Requête invalide.',400);}
 const ip=request.headers.get('cf-connecting-ip')??'local';
 if(path==='runtime/enroll'){
  const input=z.object({tokenId:id,token:z.string().min(32).max(128),runtimeId:id}).strict().parse(body);
  await repository.transaction(d=>rateLimit(d,`runtime-enroll-${ip}`,20));
  const tokenDigest=await sha256(input.token),secret=crypto.randomUUID()+crypto.randomUUID(),credentialDigest=await sha256(secret),credentialId=crypto.randomUUID();
  const result=await repository.transaction(d=>{
   const now=Date.now(),enrollment=d.runtimeEnrollmentTokens.find(t=>t.id===input.tokenId);
   if(!enrollment||enrollment.usedAt!==null||enrollment.expiresAt<=now||enrollment.digest!==tokenDigest)throw new DomainError('Token invalide ou expiré.',401);
   const target=d.stations.find(st=>st.id===enrollment.stationId&&st.partnerId===enrollment.partnerId);
   if(!target)throw new DomainError('Station indisponible.',409);
   if(d.runtimeCredentials.some(c=>c.runtimeId===input.runtimeId))throw new DomainError('Runtime déjà enregistré.',409);
   if(d.runtimeCredentials.some(c=>c.stationId===target.id&&c.revokedAt===null))throw new DomainError('Station déjà associée à un runtime actif.',409);
   enrollment.usedAt=now;
   d.runtimeCredentials.push({id:credentialId,runtimeId:input.runtimeId,stationId:target.id,partnerId:target.partnerId,digest:credentialDigest,version:1,createdAt:now,lastUsedAt:null,revokedAt:null});
   return {runtimeId:input.runtimeId,stationId:target.id,version:1};
  });
  return reply({...result,credential:secret},201);
 }
 if(path==='login'){
  const input=z.object({email:z.string().trim().email().max(200),password:z.string().min(1).max(200)}).strict().parse(body);
  const email=input.email.toLowerCase();
  await repository.transaction(d=>{rateLimit(d,`login-ip-${ip}`,30);rateLimit(d,`login-user-${email}`,12);});
  const previous=await repository.read();const candidate=previous.users.find(u=>u.email.toLowerCase()===email);
  const verified=await verifyPassword(input.password,candidate?.passwordHash??'',options.allowLegacyCredentials);
  if(!verified||!candidate)throw new DomainError('Email ou mot de passe incorrect.',401);
  const upgraded=candidate.passwordHash.startsWith('pbkdf2-')?candidate.passwordHash:await createPasswordHash(input.password);
  const token=crypto.randomUUID()+crypto.randomUUID(),digest=await sha256(token);
  const old=cookie(request,'batyeo_session'),oldDigest=old?await sha256(old):undefined;
  const user=await repository.transaction(d=>{
   const u=d.users.find(u=>u.id===candidate.id);
   if(!u||u.passwordHash!==candidate.passwordHash||!actorForUser(d,u))throw new DomainError('Email ou mot de passe incorrect.',401);
   u.passwordHash=upgraded;
   d.sessions=d.sessions.filter(s=>s.expiresAt>Date.now()&&s.id!==oldDigest);
   d.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+SESSION_LIFETIME_MS,authVersion:u.authVersion??0});
   audit(d,u,'Connexion au portail');return {id:u.id,name:u.name,role:u.role,partnerId:u.partnerId};
  });
  return reply({user},200,{'Set-Cookie':setCookie(request,'batyeo_session',token,SESSION_LIFETIME_MS/1000)});
 }
 if(path==='logout'){const token=cookie(request,'batyeo_session');const digest=token?await sha256(token):'';await repository.transaction(d=>{d.sessions=d.sessions.filter(s=>s.id!==digest);});return reply({ok:true},200,{'Set-Cookie':setCookie(request,'batyeo_session','',0)});}
 if(path==='start'){
  const input=z.object({stationPublicId:id,termsAccepted:z.literal(true),idempotencyKey:z.string().uuid()}).strict().parse(body);
  const token=customerToken(request)??'';if(!token)throw new DomainError('Rechargez la page pour préparer votre session de location.',400);const digest=await sha256(token);
  let result;
  if(stripeCoordinator){const customerId=await repository.transaction(d=>{const id=requireCustomer(d,digest);d.customerSessions.find(s=>s.id===digest)!.expiresAt=Date.now()+CUSTOMER_LIFETIME_MS;rateLimit(d,`start-${id}`,12);engine.refreshOverdue(d);return id;});result=await stripeCoordinator.start(repository,customerId,input.stationPublicId,input.idempotencyKey);}
  else result=await repository.transaction(d=>{const customerId=requireCustomer(d,digest);d.customerSessions.find(s=>s.id===digest)!.expiresAt=Date.now()+CUSTOMER_LIFETIME_MS;rateLimit(d,`start-${customerId}`,12);engine.refreshOverdue(d);return engine.start(d,customerId,input.stationPublicId,input.idempotencyKey);});
  return reply({rental:customerRentalView(await repository.read(),result)},200,{'Set-Cookie':setCookie(request,'batyeo_customer',token,7*86400)});
 }
 if(path==='customer/session'){
  const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);const customerId=crypto.randomUUID();
  const result=await repository.transaction(d=>{rateLimit(d,`customer-session-${ip}`,20);d.customerSessions=d.customerSessions.filter(s=>s.expiresAt>Date.now());d.customerSessions.push({id:digest,customerId,expiresAt:Date.now()+CUSTOMER_LIFETIME_MS});return {expiresAt:d.customerSessions.find(s=>s.id===digest)!.expiresAt};});
  return reply({sessionToken:token,...result});
 }
 if(path==='customer/handoff'){
  // A handoff link is never the session secret itself: it is a separate, short-lived,
  // single-use bridge — so a leaked link (URL, logs, message history) cannot grant
  // standing access to the customer's session the way the raw cookie value would.
  const token=cookie(request,'batyeo_customer');if(!token)throw new DomainError('Aucune session client à transférer.',401);
  const digest=await sha256(token);
  const secret=crypto.randomUUID()+crypto.randomUUID(),handoffDigest=await sha256(secret);
  const result=await repository.transaction(d=>{
   const customerId=requireCustomer(d,digest);
   rateLimit(d,`handoff-${customerId}`,10);
   d.customerHandoffTokens=d.customerHandoffTokens.filter(t=>t.expiresAt>Date.now());
   const expiresAt=Date.now()+CUSTOMER_HANDOFF_LIFETIME_MS;
   d.customerHandoffTokens.push({id:handoffDigest,customerId,createdAt:Date.now(),expiresAt,usedAt:null});
   const rental=d.rentals.filter(r=>r.customerId===customerId).sort((a,b)=>b.createdAt-a.createdAt).find(r=>OPEN_STATES.includes(r.state))??null;
   return {expiresAt,rental:rental?customerRentalView(d,rental):null};
  });
  return reply({handoffToken:secret,...result});
 }
 if(path==='customer/claim'){
  // Exchanges the single-use handoff token for a brand-new session secret tied to the
  // same customer identity. The handoff token itself is consumed here and grants no
  // further access afterward, whether or not this call succeeds.
  const input=z.object({handoffToken:z.string().regex(/^[a-zA-Z0-9-]{32,128}$/)}).strict().parse(body);
  const handoffDigest=await sha256(input.handoffToken);
  const newToken=crypto.randomUUID()+crypto.randomUUID(),newDigest=await sha256(newToken);
  const result=await repository.transaction(d=>{
   const record=d.customerHandoffTokens.find(t=>t.id===handoffDigest);
   if(!record||record.usedAt!==null||record.expiresAt<=Date.now())throw new DomainError('Lien de transfert invalide ou expiré.',401);
   rateLimit(d,`claim-${record.customerId}`,10);
   record.usedAt=Date.now();
   d.customerSessions=d.customerSessions.filter(s=>s.expiresAt>Date.now());
   d.customerSessions.push({id:newDigest,customerId:record.customerId,expiresAt:Date.now()+CUSTOMER_LIFETIME_MS});
   return {expiresAt:Date.now()+CUSTOMER_LIFETIME_MS};
  });
  return reply({ok:true,sessionToken:newToken,...result},200,{'Set-Cookie':setCookie(request,'batyeo_customer',newToken,CUSTOMER_LIFETIME_MS/1000)});
 }
 if(path==='customer/return'){
  const input=z.object({stationPublicId:id,idempotencyKey:z.string().uuid()}).strict().parse(body);const token=customerToken(request)??'';if(!token)throw new DomainError('Session client manquante.',401);const digest=await sha256(token);
  let result;
  if(stripeCoordinator){const prepared=await repository.transaction(d=>{const customerId=requireCustomer(d,digest);const stationRecord=d.stations.find(s=>s.publicId===input.stationPublicId);if(!stationRecord)throw new DomainError('Station introuvable.',404);rateLimit(d,`return-${customerId}`,12);engine.refreshOverdue(d);const rental=d.rentals.filter(r=>r.customerId===customerId).sort((a,b)=>b.createdAt-a.createdAt).find(r=>OPEN_STATES.includes(r.state));if(!rental)throw new DomainError('Aucune location active à restituer.',400);return {id:rental.id,stationId:stationRecord.id};});result=await stripeCoordinator.return(repository,prepared.id,prepared.stationId);}
  else result=await repository.transaction(d=>{const customerId=requireCustomer(d,digest);const stationRecord=d.stations.find(s=>s.publicId===input.stationPublicId);if(!stationRecord)throw new DomainError('Station introuvable.',404);rateLimit(d,`return-${customerId}`,12);engine.refreshOverdue(d);const rental=d.rentals.filter(r=>r.customerId===customerId).sort((a,b)=>b.createdAt-a.createdAt).find(r=>OPEN_STATES.includes(r.state));if(!rental)throw new DomainError('Aucune location active à restituer.',400);return engine.return(d,rental.id,stationRecord.id);});
  return reply({rental:customerRentalView(await repository.read(),result)},200,{'Set-Cookie':setCookie(request,'batyeo_customer',token,CUSTOMER_LIFETIME_MS/1000)});
 }
 if(path==='ticket'){
  const input=z.object({email:z.string().email().max(200),subject:z.string().min(3).max(150),message:z.string().min(10).max(3000),rentalId:id.optional()}).strict().parse(body);
  const data=await repository.read();const actor=await actorFor(request,data);
  const sessionToken=cookie(request,'batyeo_session');const sessionDigest=sessionToken?await sha256(sessionToken):undefined;
  const customerBearer=customerToken(request);const customerDigest=customerBearer?await sha256(customerBearer):undefined;
  const customerId=customerDigest?data.customerSessions.find(s=>s.id===customerDigest&&s.expiresAt>Date.now())?.customerId:undefined;
  const result=await repository.transaction(d=>{const current=actorForDigest(sessionDigest,d);if(actor&&!current)throw new DomainError('Veuillez vous connecter.',401);rateLimit(d,`ticket-${ip}`,5);const linked=d.rentals.find(r=>r.id===input.rentalId);if(input.rentalId&&!linked)throw new DomainError('Location introuvable.',404);if(input.rentalId&&!current&&(!customerId||linked?.customerId!==customerId))throw new DomainError('Accès refusé.',403);if(input.rentalId&&current)assertTenant(current,linked!.partnerId);const ticket={email:input.email,subject:input.subject,message:input.message,id:crypto.randomUUID(),partnerId:linked?.partnerId??current?.partnerId??null,status:'OPEN' as const,createdAt:Date.now(),rentalId:linked?.id??null,stationId:linked?.returnStationId??linked?.stationId??null,batteryId:linked?.batteryId??null,paymentId:linked?d.payments.find(p=>p.rentalId===linked!.id)?.id??null:null};d.tickets.push(ticket);return {id:ticket.id};});return reply(result,201);
 }
 const data=await repository.read();const actor=await actorFor(request,data);authorize(actor,'read');
 const token=cookie(request,'batyeo_session');const digest=token?await sha256(token):undefined;
 const write=<T>(capability:Parameters<typeof authorize>[1],mutate:(d:Data,a:Actor)=>T)=>repository.transaction(d=>{
  const current=actorForDigest(digest,d);authorize(current,capability);return mutate(d,current!);
 });

 if(path==='runtime/enrollment-token'){
  authorize(actor,'operate');const input=z.object({stationId:id}).strict().parse(body);
  const secret=crypto.randomUUID()+crypto.randomUUID(),tokenDigest=await sha256(secret),tokenId=crypto.randomUUID();
  const result=await write('operate',(d,current)=>{
   rateLimit(d,`enrollment-issue-${current.id}`,20);
   const target=d.stations.find(st=>st.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);assertTenant(current,target.partnerId);
   const now=Date.now(),expiresAt=now+600000;
   d.runtimeEnrollmentTokens.push({id:tokenId,stationId:target.id,partnerId:target.partnerId,digest:tokenDigest,createdAt:now,expiresAt,usedAt:null});
   audit(d,current,`Token enrôlement créé · ${target.id}`);return {tokenId,expiresAt};
  });return reply({...result,token:secret},201);
 }
 if(path==='runtime/rotate'){
  authorize(actor,'operate');const input=z.object({runtimeId:id,expectedVersion:z.number().int().positive()}).strict().parse(body);
  const secret=crypto.randomUUID()+crypto.randomUUID(),newDigest=await sha256(secret);
  const result=await write('operate',(d,current)=>{
   rateLimit(d,`runtime-rotate-${current.id}`,20);
   const credential=d.runtimeCredentials.find(c=>c.runtimeId===input.runtimeId);
   if(!credential||credential.revokedAt!==null)throw new DomainError('Runtime indisponible.',404);
   assertTenant(current,credential.partnerId);
   if(credential.version!==input.expectedVersion)throw new DomainError('Le credential a déjà changé.',409);
   credential.digest=newDigest;credential.version++;credential.lastUsedAt=null;
   audit(d,current,`Credential runtime renouvelé · ${credential.runtimeId}`);
   return {runtimeId:credential.runtimeId,version:credential.version};
  });return reply({...result,credential:secret});
 }
 if(path==='runtime/revoke'){
  authorize(actor,'operate');const input=z.object({runtimeId:id}).strict().parse(body);
  return reply(await write('operate',(d,current)=>{
   const credential=d.runtimeCredentials.find(c=>c.runtimeId===input.runtimeId);if(!credential)throw new DomainError('Runtime introuvable.',404);assertTenant(current,credential.partnerId);
   if(credential.revokedAt===null){credential.revokedAt=Date.now();audit(d,current,`Runtime révoqué · ${credential.runtimeId}`);}
   return {runtimeId:credential.runtimeId,revoked:true};
  }));
 }

 if(path==='manufacturer/link'){
  authorize(actor,'operate');const input=z.object({stationId:id,manufacturer:z.literal('BAJIE'),externalId:z.string().trim().min(1).max(150)}).strict().parse(body);
  return reply(await write('operate',(d,current)=>{rateLimit(d,`manufacturer-link-${current.id}`,30);const target=d.stations.find(row=>row.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);assertTenant(current,target.partnerId);const link=linkManufacturerStation(d,target.id,input.manufacturer,input.externalId);audit(d,current,`Association fabricant ${input.manufacturer} · ${target.publicId}`);return {link};}));
 }
 if(path==='station/create'){
  authorize(actor,'settings');
  const input=z.object({partnerId:id,venueId:id,publicId:z.string().trim().regex(/^[a-z0-9-]{3,64}$/),capacity:z.number().int().min(1).max(500)}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{const partner=d.partners.find(p=>p.id===input.partnerId);assertTenant(current,partner?.id??null);const stationRecord=createStation(d,input);audit(d,current,`Station créée · ${stationRecord.publicId}`);return {station:stationRecord,qrPath:publicQrUrl(new URL(request.url).origin,stationRecord.publicId)};}),201);
 }
 if(path==='venue/create'){
  authorize(actor,'settings');
  const input=z.object({partnerId:id,name:z.string().trim().min(1).max(120),city:z.string().trim().min(1).max(80),address:z.string().trim().min(1).max(200),category:z.string().trim().max(60).optional(),hours:z.string().trim().max(60).optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional()}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{assertTenant(current,input.partnerId);const venue=createVenue(d,{...input,category:input.category??'',hours:input.hours??''});audit(d,current,`Établissement créé · ${venue.name}`);return {venue};}),201);
 }
 if(path==='venue/update'){
  authorize(actor,'settings');
  const input=z.object({venueId:id,name:z.string().trim().min(1).max(120),city:z.string().trim().min(1).max(80),address:z.string().trim().min(1).max(200),category:z.string().trim().max(60).optional(),hours:z.string().trim().max(60).optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional()}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const target=d.venues.find(v=>v.id===input.venueId);if(!target)throw new DomainError('Établissement introuvable.',404);
   assertTenant(current,target.partnerId);
   const before=`${target.address} · ${target.city}`;
   const venue=updateVenue(d,input.venueId,{...input,category:input.category??'',hours:input.hours??''});
   audit(d,current,`Établissement modifié · ${venue.name}${before===`${venue.address} · ${venue.city}`?'':` · adresse : ${before} → ${venue.address} · ${venue.city}`}`);
   return {venue};
  }));
 }
 if(path==='partner/create'){
  authorize(actor,'settings');
  const input=z.object({name:z.string().trim().min(1).max(120),city:z.string().trim().min(1).max(80),adminEmail:z.string().trim().email().max(200),adminName:z.string().trim().min(1).max(80)}).strict().parse(body);
  const temporaryPassword=crypto.randomUUID().replace(/-/g,'').slice(0,16); // shown once in the response, never logged, never stored in plaintext
  const passwordHash=await createPasswordHash(temporaryPassword);
  const result=await write('settings',(d,current)=>{
   if(!['SUPER_ADMIN','ADMIN'].includes(current.role))throw new DomainError('Seul le personnel BATYEO peut créer un nouveau partenaire.',403);
   const {partner,user}=createPartner(d,input,passwordHash);
   audit(d,current,`Partenaire créé · ${partner.name} (${user.email})`);
   return {partner};
  });
  return reply({...result,adminEmail:input.adminEmail.trim().toLowerCase(),temporaryPassword},201);
 }
 if(path==='partner/set-commission'){
  authorize(actor,'pricing');
  const input=z.object({partnerId:id,commissionBps:z.union([z.literal(COMMISSION_TIERS_BPS[0]),z.literal(COMMISSION_TIERS_BPS[1]),z.literal(COMMISSION_TIERS_BPS[2]),z.literal(COMMISSION_TIERS_BPS[3]),z.literal(COMMISSION_TIERS_BPS[4])]).nullable()}).strict().parse(body);
  return reply(await write('pricing',(d,current)=>{
   const partner=setPartnerCommission(d,input.partnerId,input.commissionBps);
   audit(d,current,`Commission partenaire · ${partner.name} · ${input.commissionBps===null?'taux de la grille':`${input.commissionBps/100} %`}`);
   return {partner};
  }));
 }
 if(path==='media/upload-token'){
  authorize(actor,'settings');
  const handler=dependencies.handleMediaUpload??handleUpload;
  let jsonResponse:Awaited<ReturnType<typeof handleUpload>>;
  try{
   jsonResponse=await handler({
    body:body as HandleUploadBody,request,
    onBeforeGenerateToken:async(_pathname,clientPayload)=>{
     const kind=z.enum(['IMAGE','VIDEO']).catch('IMAGE').parse(clientPayload);
     const limits=MEDIA_UPLOAD_LIMITS[kind];
     return {allowedContentTypes:[...limits.types],maximumSizeInBytes:limits.maxBytes,addRandomSuffix:true};
    },
   });
  }catch(e){throw new DomainError(e instanceof Error?e.message:'Le stockage de médias (Vercel Blob) est indisponible. Vérifiez qu’il est activé pour ce projet.',503);}
  return reply(jsonResponse);
 }
 if(path==='media/create'){
  authorize(actor,'settings');
  const input=z.object({name:z.string().trim().min(1).max(120),kind:z.enum(['IMAGE','VIDEO']),uri:z.string().url(),durationMs:z.number().int().min(1000).max(86_400_000),startsAt:z.number().int().nullable().optional(),endsAt:z.number().int().nullable().optional(),targetStationIds:z.array(id).max(200).optional(),checksum:z.string().trim().min(1).max(200).optional()}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   if(current.role==='PARTNER_ADMIN'){
    if(!input.targetStationIds?.length)throw new DomainError('Sélectionnez au moins une station de votre établissement.',400);
    for(const stationId of input.targetStationIds){const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station cible introuvable.',404);assertTenant(current,station.partnerId);}
   }
   const item=createMedia(d,input);audit(d,current,`Média créé · ${item.name}`);return {media:item};
  }),201);
 }
 if(path==='media/publish'||path==='media/archive'){
  authorize(actor,'settings');
  const input=z.object({id}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const existing=d.media.find(m=>m.id===input.id);if(!existing)throw new DomainError('Média introuvable.',404);
   if(current.role==='PARTNER_ADMIN'){
    if(!existing.targetStationIds.length)throw new DomainError('Média introuvable.',404);
    for(const stationId of existing.targetStationIds){const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station cible introuvable.',404);assertTenant(current,station.partnerId);}
   }
   const item=setMediaStatus(d,input.id,path==='media/publish'?'PUBLISHED':'ARCHIVED');audit(d,current,`Média ${path==='media/publish'?'publié':'archivé'} · ${item.name}`);return {media:item};
  }));
 }
 if(path==='display/config'){
  authorize(actor,'settings');
  const input=z.object({stationId:id,idleContent:z.string().max(2000),supportContact:z.string().max(200),maintenanceBanner:z.string().max(500).nullable(),locale:z.string().min(2).max(20),refreshIntervalMs:z.number().int().min(5000).max(600_000),featureFlags:z.record(z.boolean()).optional()}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const station=d.stations.find(s=>s.id===input.stationId);if(!station)throw new DomainError('Station introuvable.',404);
   assertTenant(current,station.partnerId);
   const existing=d.displayConfigs.find(row=>row.stationId===input.stationId);
   // updatedAt is the version runtimes compare against, so it always moves forward.
   const updatedAt=Math.max(Date.now(),(existing?.updatedAt??0)+1);
   const record={id:existing?.id??crypto.randomUUID(),stationId:input.stationId,idleContent:input.idleContent,supportContact:input.supportContact,maintenanceBanner:input.maintenanceBanner,locale:input.locale,refreshIntervalMs:input.refreshIntervalMs,featureFlags:input.featureFlags??existing?.featureFlags??{},translations:existing?.translations??null,updatedAt};
   if(existing)Object.assign(existing,record);else d.displayConfigs.push(record);
   audit(d,current,`Affichage borne mis à jour · ${station.publicId}`);
   return {config:record};
  }));
 }
 if(path==='station/stripe-location'){
  authorize(actor,'settings');
  const input=z.object({stationId:id,locationId:z.string().trim().max(255).nullable()}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const station=d.stations.find(s=>s.id===input.stationId);if(!station)throw new DomainError('Station introuvable.',404);
   assertTenant(current,station.partnerId);
   const updated=setStripeTerminalLocation(d,input.stationId,input.locationId?.trim()||null);
   audit(d,current,`Location Stripe Terminal assignée · ${station.publicId}`);
   return {station:updated};
  }));
 }
 if(path==='station/stripe-location/create'){
  // One action instead of a round trip through the Stripe dashboard: create the Location in the
  // merchant's own account from the venue it belongs to, then assign it to the station.
  authorize(actor,'settings');if(paymentMode!=='stripe_test')throw new DomainError('Stripe TEST n’est pas configuré sur ce serveur.',503);
  const input=z.object({stationId:id,country:z.string().trim().length(2),postalCode:z.string().trim().max(20).optional(),state:z.string().trim().max(100).optional(),displayName:z.string().trim().min(1).max(120).optional()}).strict().parse(body);
  const source=await repository.read();const target=source.stations.find(s=>s.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);
  assertTenant(actor!,target.partnerId);
  const venue=source.venues.find(v=>v.id===target.venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
  // Created before the commit: a Stripe object must never be produced inside a transaction.
  const location=await createTerminalLocation(process.env.STRIPE_SECRET_KEY!,{displayName:input.displayName??`${venue.name} · ${target.publicId}`,line1:venue.address,city:venue.city,country:input.country,postalCode:input.postalCode,state:input.state});
  return reply(await write('settings',(d,current)=>{
   const station=d.stations.find(s=>s.id===input.stationId);if(!station)throw new DomainError('Station introuvable.',404);
   assertTenant(current,station.partnerId);
   const updated=setStripeTerminalLocation(d,input.stationId,location.id);
   audit(d,current,`Location Stripe Terminal créée et assignée · ${station.publicId} · ${location.id}`);
   return {station:updated,location};
  }));
 }
 if(path==='station/archive'){
  authorize(actor,'settings');
  const input=z.object({stationId:id}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const target=d.stations.find(s=>s.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);
   assertTenant(current,target.partnerId);
   const updated=archiveStation(d,input.stationId);
   audit(d,current,`Station archivée · ${target.publicId}`);
   return {station:updated};
  }));
 }
 if(path==='station/restore'){
  authorize(actor,'settings');
  const input=z.object({stationId:id}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const target=d.stations.find(s=>s.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);
   assertTenant(current,target.partnerId);
   const updated=restoreStation(d,input.stationId);
   audit(d,current,`Station restaurée · ${target.publicId}`);
   return {station:updated};
  }));
 }
 if(path==='station/relocate'){
  authorize(actor,'settings');
  const input=z.object({stationId:id,venueId:id}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const target=d.stations.find(s=>s.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);
   assertTenant(current,target.partnerId);
   const venue=d.venues.find(v=>v.id===input.venueId);if(!venue)throw new DomainError('Établissement introuvable.',404);
   // Handing hardware to a different client is a platform-level call, not something a partner
   // grants itself — moving between two of one's own venues stays a plain 'settings' action.
   if(venue.partnerId!==target.partnerId&&!['SUPER_ADMIN','ADMIN'].includes(current.role))throw new DomainError('Seul le personnel BATYEO peut transférer une borne à un autre partenaire.',403);
   const previousVenue=d.venues.find(v=>v.id===target.venueId)?.name??target.venueId;
   const updated=relocateStation(d,input.stationId,input.venueId);
   audit(d,current,`Station déplacée · ${target.publicId} · ${previousVenue} → ${venue.name}`);
   return {station:updated};
  }));
 }
 if(path==='station/block-rentals'){
  authorize(actor,'operate');
  const input=z.object({stationId:id,reason:z.string().trim().min(1).max(500)}).strict().parse(body);
  return reply(await write('operate',(d,current)=>{
   const station=d.stations.find(s=>s.id===input.stationId);if(!station)throw new DomainError('Station introuvable.',404);
   assertTenant(current,station.partnerId);
   const updated=blockStationRentals(d,input.stationId,input.reason);
   audit(d,current,`Locations bloquées · ${station.publicId} · ${input.reason}`);
   return {station:updated};
  }));
 }
 if(path==='station/unblock-rentals'){
  authorize(actor,'operate');
  const input=z.object({stationId:id}).strict().parse(body);
  return reply(await write('operate',(d,current)=>{
   const station=d.stations.find(s=>s.id===input.stationId);if(!station)throw new DomainError('Station introuvable.',404);
   assertTenant(current,station.partnerId);
   const updated=unblockStationRentals(d,input.stationId);
   audit(d,current,`Locations débloquées · ${station.publicId}`);
   return {station:updated};
  }));
 }
 if(path==='display/translations'){
  authorize(actor,'settings');
  const input=z.object({stationIds:z.array(id).min(1).max(200),defaultLocale:z.string().min(2).max(20),available:z.array(z.object({code:z.string().min(1).max(10),label:z.string().min(1).max(60),locale:z.string().min(2).max(20)})).min(1).max(40),strings:z.record(z.record(z.string().max(2000)))}).strict().parse(body);
  return reply(await write('settings',(d,current)=>{
   const translations=validateTranslations({defaultLocale:input.defaultLocale,available:input.available,strings:input.strings});
   const updated:string[]=[];
   for(const stationId of input.stationIds){
    const station=d.stations.find(s=>s.id===stationId);if(!station)throw new DomainError('Station introuvable.',404);
    assertTenant(current,station.partnerId);
    const existing=d.displayConfigs.find(row=>row.stationId===stationId);
    const updatedAt=Math.max(Date.now(),(existing?.updatedAt??0)+1);
    if(existing){existing.translations=translations;existing.updatedAt=updatedAt;}
    else d.displayConfigs.push({id:crypto.randomUUID(),stationId,idleContent:'',supportContact:'',maintenanceBanner:null,locale:input.defaultLocale,refreshIntervalMs:15_000,featureFlags:{},translations,updatedAt});
    updated.push(stationId);
   }
   audit(d,current,`Traductions publiées · ${updated.length} borne(s)`);
   return {stations:updated.length,locales:input.available.length};
  }));
 }
 if(path==='manufacturer/sync'){
  authorize(actor,'operate');if(!manufacturerSync)throw new DomainError('Provider fabricant non configuré.',503);const input=z.object({stationId:id.optional()}).strict().parse(body);if(input.stationId){const target=data.stations.find(row=>row.id===input.stationId);if(!target)throw new DomainError('Station introuvable.',404);assertTenant(actor!,target.partnerId);}
  await write('operate',(d,current)=>{rateLimit(d,`manufacturer-sync-${current.id}`,20);audit(d,current,`Synchronisation fabricant read-only${input.stationId?' · '+input.stationId:''}`);});return reply({run:await manufacturerSync.run({trigger:'MANUAL',requestedBy:actor,stationId:input.stationId})});
 }
 if(path==='rental/resolve-ejection'){
  // Manual close-out of a PHYSICAL_UNKNOWN incident (docs/RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md):
  // an operator has already queried the manufacturer read-only and knows what really happened.
  authorize(actor,'operate');
  const input=z.object({rentalId:id,outcome:z.enum(['EJECTED','NOT_EJECTED']),batteryId:id.optional()}).strict().refine(v=>v.outcome!=='EJECTED'||!!v.batteryId,'Identifiant de batterie requis.').parse(body);
  const target=data.rentals.find(r=>r.id===input.rentalId);if(!target)throw new DomainError('Location introuvable.',404);
  assertTenant(actor!,target.partnerId);
  const auditMessage=`Résultat physique réconcilié · ${input.outcome==='EJECTED'?'batterie sortie':'batterie non sortie'} · ${input.rentalId}`;
  if(stripeCoordinator){
   await write('operate',(d,current)=>{rateLimit(d,`resolve-ejection-${current.id}`,20);audit(d,current,auditMessage);});
   const result=input.outcome==='EJECTED'?await stripeCoordinator.resolveEjectionConfirmed(repository,input.rentalId,input.batteryId!):await stripeCoordinator.resolveEjectionFailed(repository,input.rentalId);
   return reply({rental:rentalView(await repository.read(),result,canViewFinance(actor!))});
  }
  const result=await write('operate',(d,current)=>{
   rateLimit(d,`resolve-ejection-${current.id}`,20);audit(d,current,auditMessage);
   if(input.outcome==='EJECTED')return engine.resolveEjectionConfirmed(d,input.rentalId,input.batteryId!);
   engine.resolveEjectionFailed(d,input.rentalId);engine.markPaymentReleased(d,input.rentalId);return d.rentals.find(r=>r.id===input.rentalId)!;
  });
  return reply({rental:rentalView(await repository.read(),result,canViewFinance(actor!))});
 }

 if(path==='simulate'){
  authorize(actor,'operate');
  const input=z.object({action:z.enum(['online','offline','available','empty','ejection','timeout','payment','none','return','delay']),stationId:id,rentalId:id.optional(),minutes:z.number().int().min(0).max(10080).optional()}).strict().parse(body);
  if(!options.demo)throw new DomainError('Le simulateur est réservé à la prévisualisation.',403);
  return reply(await write('operate',(d,actor)=>{
   rateLimit(d,`simulate-${actor!.id}`,60);const s=station.getStation(d,input.stationId);assertTenant(actor!,s.partnerId);engine.refreshOverdue(d);
   if(input.action==='return'||input.action==='delay'){
    const r=d.rentals.find(r=>r.id===input.rentalId);if(!r)throw new DomainError('Sélectionnez une location.',400);assertTenant(actor!,r.partnerId);
    if(input.action==='return')engine.return(d,r.id,s.id);
    else {if(!['ACTIVE','OVERDUE'].includes(r.state))throw new DomainError('La location est déjà clôturée.');r.simulatedMinutes+=input.minutes??61;engine.refreshOverdue(d);d.events.push({id:crypto.randomUUID(),rentalId:r.id,at:Date.now(),type:'SIMULATED_TIME',detail:`Temps de démonstration avancé de ${input.minutes??61} minutes`});}
   }else if(input.action==='online'||input.action==='offline')station.setOnline(d,s.id,input.action==='online');
   else if(['ejection','timeout','payment','none'].includes(input.action))station.simulateFailure(d,s.id,input.action as 'ejection'|'timeout'|'payment'|'none');
   else {for(const slot of d.slots.filter(sl=>sl.stationId===s.id)){const b=d.batteries.find(b=>b.id===slot.batteryId);if(b)b.status=input.action==='empty'?'MAINTENANCE':'AVAILABLE';}if(input.action==='available'&&station.getAvailability(d,s.id)===0){const free=d.slots.find(sl=>sl.stationId===s.id&&!sl.batteryId);if(!free)throw new DomainError('Aucun emplacement libre.');const batteryId=`BAT-DEMO-${crypto.randomUUID().slice(0,8)}`;d.batteries.push({id:batteryId,charge:100,status:'AVAILABLE'});free.batteryId=batteryId;}}
   audit(d,actor!,`Simulation : ${input.action} · ${s.publicId}`);return {ok:true};
  }));
 }
 if(path==='pricing'){
  authorize(actor,'pricing');const input=z.object({hourlyCents:z.number().int().min(100).max(1000),capCents:z.number().int().min(100).max(2000),depositCents:z.number().int().min(100).max(10000),deadlineHours:z.number().int().min(1).max(168),commissionBps:z.number().int().min(0).max(10000)}).strict().refine(v=>v.capCents<=v.depositCents&&v.hourlyCents<=v.capCents,'Le plafond doit être compris entre le tarif horaire et la caution.').parse(body);
  await write('pricing',(d,actor)=>{d.pricing=[{...input,id:crypto.randomUUID()}];audit(d,actor!,'Tarification mise à jour pour les prochaines locations');});return reply({ok:true});
 }
 if(path==='resolve-ticket'){
  authorize(actor,'support');const input=z.object({id}).strict().parse(body);await write('support',(d,actor)=>{const t=d.tickets.find(t=>t.id===input.id);if(!t)throw new DomainError('Demande introuvable.',404);assertTenant(actor!,t.partnerId);t.status='RESOLVED';audit(d,actor!,'Demande résolue : '+t.id);});return reply({ok:true});
 }
 if(path==='settings'){
  authorize(actor,'settings');const input=z.object({name:z.string().trim().min(2).max(80)}).strict().parse(body);await write('settings',(d,actor)=>{const u=d.users.find(u=>u.id===actor.id)!;u.name=input.name;audit(d,actor!,'Profil mis à jour');});return reply({ok:true});
 }
 throw new DomainError('Opération introuvable.',404);
}
async function handle(request:Request,context:{params:Promise<{path:string[]}>}) {try{return await route(request,(await context.params).path.join('/'));}catch(e){if(e instanceof ZodError)return reply({error:e.issues[0]?.message==='Invalid literal value, expected true'?'Veuillez accepter les conditions.':'Vérifiez les informations saisies.',details:e.issues.map(i=>i.path.join('.'))},400);if(e instanceof DomainError)return reply({error:e.message},e.status);console.error('BATYEO request failed',e instanceof Error?e.message:'Unknown error');return reply({error:'Le service est temporairement indisponible. Réessayez dans un instant.'},503);}}
return {GET:handle,POST:handle};
}
