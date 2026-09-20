import {Prisma,PrismaClient} from '@prisma/client';
import type {Repository} from '../../core/repository';
import {PAYMENT_STATES,PHYSICAL_STATES,type Data} from '../../core/types';
import type {PricingStrategy} from '../../core/pricing';
import {validateData} from '../../core/invariants';
import {DomainError} from '../../core/providers';

type Tx=Prisma.TransactionClient;
const ms=(date:Date|null)=>date?.getTime()??null;
const date=(value:number|null|undefined)=>value==null?null:new Date(value);
const snapshot=(p:Prisma.JsonValue)=>p as unknown as PricingStrategy;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function sync<T extends {id:string}>(before:T[],after:T[],write:(row:T)=>Promise<unknown>,remove?:(ids:string[])=>Promise<unknown>){
 const old=new Map(before.map(row=>[row.id,row]));
 for(const row of after){if(!same(old.get(row.id),row))await write(row);old.delete(row.id);}
 if(old.size&&remove)await remove([...old.keys()]);
 if(old.size&&!remove)throw new Error('Deleting durable domain records is not supported.');
}
/** Normalized PostgreSQL adapter. No automatic demo seed, no fallback to SQLite.
 * Serializes snapshot writes at a database row; serializable conflicts are retried.
 * The lock is process-independent and preserves all existing domain invariants. */
export class PrismaRepository implements Repository {
 constructor(private readonly client:PrismaClient){}
 private async load(tx:Tx):Promise<Data>{
  const [users,partners,venues,stations,slots,batteries,rentals,events,payments,pricing,terms,tickets,audits,sessions,partnerUsers,limits,customerSessions,customerHandoffTokens,webhookEvents,stationProviderLinks,stationProviderSnapshots,reconciliationRecords,manufacturerSyncRuns,runtimeCredentials,runtimeEnrollmentTokens,hardwareDiscoveryReports,stationCapabilities,media]=await Promise.all([
   tx.user.findMany(),tx.partner.findMany(),tx.venue.findMany(),tx.station.findMany(),tx.slot.findMany(),tx.battery.findMany(),tx.rental.findMany(),tx.rentalEvent.findMany(),tx.payment.findMany(),tx.pricingStrategy.findMany({where:{active:true}}),tx.termsAcceptance.findMany(),tx.supportTicket.findMany(),tx.auditLog.findMany(),tx.session.findMany(),tx.partnerUser.findMany(),tx.rateLimit.findMany(),tx.customerSession.findMany(),tx.customerHandoffToken.findMany(),tx.webhookEvent.findMany(),tx.stationProviderLink.findMany(),tx.stationProviderSnapshot.findMany(),tx.reconciliationRecord.findMany(),tx.manufacturerSyncRun.findMany(),tx.runtimeCredential.findMany(),tx.runtimeEnrollmentToken.findMany(),tx.hardwareDiscoveryReport.findMany(),tx.stationCapability.findMany(),tx.media.findMany()
  ]);
  return {
   users:users.map(u=>({...u,disabledAt:ms(u.disabledAt)})),partners,venues,
   stations:stations.map(s=>({...s,failure:s.failure as Data['stations'][number]['failure'],provider:s.provider==='manufacturer'?'manufacturer':'mock',providerLastSyncedAt:ms(s.providerLastSyncedAt),lastSeenAt:ms(s.lastSeenAt),stripeTerminalLocationUpdatedAt:ms(s.stripeTerminalLocationUpdatedAt),rentalsBlockedAt:ms(s.rentalsBlockedAt),archivedAt:ms(s.archivedAt)})),slots,
   batteries:batteries.map(b=>({...b,status:b.status as Data['batteries'][number]['status']})),
   rentals:rentals.map(row=>{const {pricingId,pricingSnapshot,...r}=row;void pricingId;return ({...r,paymentState:r.paymentState&&PAYMENT_STATES.includes(r.paymentState as typeof PAYMENT_STATES[number])?r.paymentState as Data['rentals'][number]['paymentState']:undefined,physicalState:r.physicalState&&PHYSICAL_STATES.includes(r.physicalState as typeof PHYSICAL_STATES[number])?r.physicalState as Data['rentals'][number]['physicalState']:undefined,createdAt:r.createdAt.getTime(),startedAt:ms(r.startedAt),returnedAt:ms(r.returnedAt),deadline:ms(r.deadline),pricing:snapshot(pricingSnapshot)});}),
   events:events.map(e=>({...e,at:e.at.getTime()})),
   payments:payments.map(p=>({...p,disputedAt:ms(p.disputedAt),status:PAYMENT_STATES.includes(p.status as typeof PAYMENT_STATES[number])?p.status as Data['payments'][number]['status']:'UNKNOWN',provider:p.provider==='stripe'?'stripe':'mock',providerReference:p.providerReference,error:p.error,requestedCents:p.requestedCents??undefined})),
   pricing:pricing.map(row=>({id:row.id,hourlyCents:row.hourlyCents,capCents:row.capCents,depositCents:row.depositCents,deadlineHours:row.deadlineHours,commissionBps:row.commissionBps})),
   terms:terms.map(t=>({...t,acceptedAt:t.acceptedAt.getTime()})),
   tickets:tickets.map(t=>({...t,createdAt:t.createdAt.getTime(),status:t.status as Data['tickets'][number]['status']})),
   audits:audits.map(a=>({...a,at:a.at.getTime()})),sessions:sessions.map(s=>({...s,expiresAt:s.expiresAt.getTime()})),partnerUsers,
   limits:limits.map(l=>({...l,expiresAt:l.expiresAt.getTime()})),customerSessions:customerSessions.map(s=>({...s,expiresAt:s.expiresAt.getTime()})),customerHandoffTokens:customerHandoffTokens.map(t=>({...t,createdAt:t.createdAt.getTime(),expiresAt:t.expiresAt.getTime(),usedAt:ms(t.usedAt)})),webhookEvents:webhookEvents.map(e=>({...e,receivedAt:e.receivedAt.getTime(),processedAt:ms(e.processedAt),payload:e.payload,status:e.status as Data['webhookEvents'][number]['status']})),
   stationProviderLinks:stationProviderLinks.map(link=>({...link,manufacturer:link.manufacturer as Data['stationProviderLinks'][number]['manufacturer'],createdAt:link.createdAt.getTime(),updatedAt:link.updatedAt.getTime()})),
   stationProviderSnapshots:stationProviderSnapshots.map(row=>({...row,syncedAt:row.syncedAt.getTime(),slots:row.slots as unknown as Data['stationProviderSnapshots'][number]['slots']})),
   reconciliationRecords:reconciliationRecords.map(row=>({...row,kind:row.kind as Data['reconciliationRecords'][number]['kind'],status:row.status as Data['reconciliationRecords'][number]['status'],localValue:(row.localValue as {value:unknown}).value,providerValue:(row.providerValue as {value:unknown}).value,firstDetectedAt:row.firstDetectedAt.getTime(),lastDetectedAt:row.lastDetectedAt.getTime(),resolvedAt:ms(row.resolvedAt)})),
   manufacturerSyncRuns:manufacturerSyncRuns.map(row=>({...row,provider:row.provider as Data['manufacturerSyncRuns'][number]['provider'],trigger:row.trigger as Data['manufacturerSyncRuns'][number]['trigger'],status:row.status as Data['manufacturerSyncRuns'][number]['status'],errorSummary:row.errorSummary as unknown as Data['manufacturerSyncRuns'][number]['errorSummary'],startedAt:row.startedAt.getTime(),completedAt:ms(row.completedAt)})),
   runtimeCredentials:runtimeCredentials.map(row=>({...row,createdAt:row.createdAt.getTime(),lastUsedAt:ms(row.lastUsedAt),revokedAt:ms(row.revokedAt)})),
   runtimeEnrollmentTokens:runtimeEnrollmentTokens.map(row=>({...row,createdAt:row.createdAt.getTime(),expiresAt:row.expiresAt.getTime(),usedAt:ms(row.usedAt)})),
   hardwareDiscoveryReports:hardwareDiscoveryReports.map(row=>({...row,collectedAt:row.collectedAt.getTime()})),
   stationCapabilities:stationCapabilities.map(row=>({...row,verifiedAt:ms(row.verifiedAt)})),
   media:media.map(row=>({...row,kind:row.kind as Data['media'][number]['kind'],status:row.status as Data['media'][number]['status'],startsAt:ms(row.startsAt),endsAt:ms(row.endsAt),targetStationIds:row.targetStationIds as unknown as Data['media'][number]['targetStationIds'],createdAt:row.createdAt.getTime()})),
   displayConfigs:[],stationHeartbeats:[]
  };
 }
 async read():Promise<Data>{return this.client.$transaction(tx=>this.load(tx),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30_000});}
 private async save(tx:Tx,before:Data,after:Data){
  validateData(after);
  await sync(before.partners,after.partners,p=>tx.partner.upsert({where:{id:p.id},create:p,update:p}));
  await sync(before.users,after.users,u=>{const data={...u,disabledAt:date(u.disabledAt),authVersion:u.authVersion??0};return tx.user.upsert({where:{id:u.id},create:data,update:data});});
  await sync(before.partnerUsers,after.partnerUsers,m=>tx.partnerUser.upsert({where:{id:m.id},create:m,update:m}),ids=>tx.partnerUser.deleteMany({where:{id:{in:ids}}}));
  await sync(before.venues,after.venues,v=>tx.venue.upsert({where:{id:v.id},create:v,update:v}));
  await sync(before.stations,after.stations,s=>{const data={...s,provider:s.provider??'mock',providerDeviceId:s.providerDeviceId??null,providerStatus:s.providerStatus??null,providerLastSyncedAt:date(s.providerLastSyncedAt),lastSeenAt:date(s.lastSeenAt),stripeTerminalLocationId:s.stripeTerminalLocationId??null,stripeTerminalLocationUpdatedAt:date(s.stripeTerminalLocationUpdatedAt),rentalsBlocked:s.rentalsBlocked??false,rentalsBlockedReason:s.rentalsBlockedReason??null,rentalsBlockedAt:date(s.rentalsBlockedAt),archivedAt:date(s.archivedAt)};return tx.station.upsert({where:{id:s.id},create:data,update:data});});
  await sync(before.batteries,after.batteries,b=>tx.battery.upsert({where:{id:b.id},create:b,update:b}));
  // Release moved batteries first, then attach them at the destination. All inside one TX.
  const changedSlots=after.slots.filter(s=>!same(before.slots.find(b=>b.id===s.id),s));
  if(changedSlots.length)await tx.slot.updateMany({where:{id:{in:changedSlots.map(s=>s.id)}},data:{batteryId:null}});
  await sync(before.slots,after.slots,s=>tx.slot.upsert({where:{id:s.id},create:s,update:s}));
  const allPricing=new Map([...after.rentals.map(r=>r.pricing),...after.pricing].map(p=>[p.id,p]));
  const current=after.pricing[0]?.id;
  if(!same(before.pricing,after.pricing))await tx.pricingStrategy.updateMany({where:{active:true},data:{active:false}});
  for(const p of allPricing.values()){
   const existing=await tx.pricingStrategy.findUnique({where:{id:p.id}});
   if(existing){const {active,...stored}=existing;void active;if(!same(stored,p)){
     // Compare properties, not JSON key insertion order.
     if(['hourlyCents','capCents','depositCents','deadlineHours','commissionBps'].some(k=>stored[k as keyof typeof stored]!==p[k as keyof PricingStrategy]))throw new Error('Pricing versions are immutable.');
    }if(existing.active!==(p.id===current))await tx.pricingStrategy.update({where:{id:p.id},data:{active:p.id===current}});
   }else await tx.pricingStrategy.create({data:{...p,active:p.id===current}});
  }
  await sync(before.rentals,after.rentals,r=>{const {pricing,...rest}=r;const data={...rest,createdAt:new Date(r.createdAt),startedAt:date(r.startedAt),returnedAt:date(r.returnedAt),deadline:date(r.deadline),pricingId:pricing.id,pricingSnapshot:pricing as unknown as Prisma.InputJsonValue};return tx.rental.upsert({where:{id:r.id},create:data,update:data});});
  await sync(before.events,after.events,e=>{const data={...e,at:new Date(e.at)};return tx.rentalEvent.create({data});});
  await sync(before.payments,after.payments,p=>{const data={...p,refundedCents:p.refundedCents??0,disputedAt:date(p.disputedAt)};return tx.payment.upsert({where:{id:p.id},create:data,update:data});});
  await sync(before.terms,after.terms,t=>tx.termsAcceptance.create({data:{...t,acceptedAt:new Date(t.acceptedAt)}}));
  await sync(before.tickets,after.tickets,t=>{const data={...t,createdAt:new Date(t.createdAt)};return tx.supportTicket.upsert({where:{id:t.id},create:data,update:data});});
  await sync(before.audits,after.audits,a=>tx.auditLog.create({data:{...a,at:new Date(a.at)}}));
  await sync(before.sessions,after.sessions,s=>{const data={...s,expiresAt:new Date(s.expiresAt),authVersion:s.authVersion??0};return tx.session.upsert({where:{id:s.id},create:data,update:data});},ids=>tx.session.deleteMany({where:{id:{in:ids}}}));
  await sync(before.limits,after.limits,l=>{const data={...l,expiresAt:new Date(l.expiresAt)};return tx.rateLimit.upsert({where:{id:l.id},create:data,update:data});},ids=>tx.rateLimit.deleteMany({where:{id:{in:ids}}}));
  await sync(before.customerSessions,after.customerSessions,s=>{const data={...s,expiresAt:new Date(s.expiresAt)};return tx.customerSession.upsert({where:{id:s.id},create:data,update:data});},ids=>tx.customerSession.deleteMany({where:{id:{in:ids}}}));
  await sync(before.customerHandoffTokens,after.customerHandoffTokens,t=>{const data={...t,createdAt:new Date(t.createdAt),expiresAt:new Date(t.expiresAt),usedAt:date(t.usedAt)};return tx.customerHandoffToken.upsert({where:{id:t.id},create:data,update:data});},ids=>tx.customerHandoffToken.deleteMany({where:{id:{in:ids}}}));
  await sync(before.webhookEvents,after.webhookEvents,e=>{const data={...e,receivedAt:new Date(e.receivedAt),processedAt:date(e.processedAt),payload:e.payload as Prisma.InputJsonValue,status:e.status};return tx.webhookEvent.upsert({where:{id:e.id},create:data,update:data});},ids=>tx.webhookEvent.deleteMany({where:{id:{in:ids}}}));
  await sync(before.stationProviderLinks,after.stationProviderLinks,link=>{const data={...link,createdAt:new Date(link.createdAt),updatedAt:new Date(link.updatedAt)};return tx.stationProviderLink.upsert({where:{id:link.id},create:data,update:data});});
  await sync(before.stationProviderSnapshots,after.stationProviderSnapshots,row=>{const data={...row,syncedAt:new Date(row.syncedAt),slots:row.slots as unknown as Prisma.InputJsonValue};return tx.stationProviderSnapshot.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.reconciliationRecords,after.reconciliationRecords,row=>{const data={...row,localValue:{value:row.localValue} as Prisma.InputJsonValue,providerValue:{value:row.providerValue} as Prisma.InputJsonValue,firstDetectedAt:new Date(row.firstDetectedAt),lastDetectedAt:new Date(row.lastDetectedAt),resolvedAt:date(row.resolvedAt)};return tx.reconciliationRecord.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.manufacturerSyncRuns,after.manufacturerSyncRuns,row=>{const data={...row,errorSummary:row.errorSummary as unknown as Prisma.InputJsonValue,startedAt:new Date(row.startedAt),completedAt:date(row.completedAt)};return tx.manufacturerSyncRun.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.runtimeCredentials,after.runtimeCredentials,row=>{const data={...row,createdAt:new Date(row.createdAt),lastUsedAt:date(row.lastUsedAt),revokedAt:date(row.revokedAt)};return tx.runtimeCredential.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.runtimeEnrollmentTokens,after.runtimeEnrollmentTokens,row=>{const data={...row,createdAt:new Date(row.createdAt),expiresAt:new Date(row.expiresAt),usedAt:date(row.usedAt)};return tx.runtimeEnrollmentToken.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.hardwareDiscoveryReports,after.hardwareDiscoveryReports,row=>{const data={...row,collectedAt:new Date(row.collectedAt),report:row.report as Prisma.InputJsonValue};return tx.hardwareDiscoveryReport.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.stationCapabilities,after.stationCapabilities,row=>{const data={...row,verifiedAt:date(row.verifiedAt)};return tx.stationCapability.upsert({where:{id:row.id},create:data,update:data});});
  await sync(before.media,after.media,row=>{const data={...row,startsAt:date(row.startsAt),endsAt:date(row.endsAt),targetStationIds:row.targetStationIds as unknown as Prisma.InputJsonValue,createdAt:new Date(row.createdAt)};return tx.media.upsert({where:{id:row.id},create:data,update:data});});
 }
 async transaction<T>(mutate:(data:Data)=>T):Promise<T>{
  for(let attempt=0;attempt<5;attempt++)try{
   return await this.client.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "CoreRevision" WHERE id=1 FOR UPDATE`;
    const before=await this.load(tx),next=structuredClone(before),value=mutate(next);
    await this.save(tx,before,next);
    await tx.coreRevision.update({where:{id:1},data:{version:{increment:1}}});
    return value;
   },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10_000,timeout:30_000});
  }catch(error){
   if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034')throw error;
   if(attempt<4)await new Promise(resolve=>setTimeout(resolve,10*(attempt+1)));
  }
  throw new DomainError('Une opération concurrente est en cours. Réessayez.',409);
 }
}
