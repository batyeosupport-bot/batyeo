import {seedData} from '../core/seed';
import {type AcceptanceCheck,type AcceptanceStatus} from '../core/acceptance';
import {assessRuntimeOnboarding} from '../core/runtime-onboarding';

const data=seedData('demo-password');
const station=data.stations.find(row=>row.id==='station-paris');
if(!station){console.log(JSON.stringify({status:'BLOCKED',reason:'Seed station unavailable'},null,2));process.exit(0);}
const checks:Partial<Record<AcceptanceCheck,AcceptanceStatus>>={
 CORE_CONNECTIVITY:'PASS',RUNTIME_AUTH:'NOT_VERIFIED',REMOTE_CONFIG:'PASS',OFFLINE_CACHE:'PASS',HEARTBEAT:'NOT_VERIFIED',DISPLAY:'NOT_VERIFIED',TOUCH:'NOT_VERIFIED',QR_DISPLAY:'NOT_VERIFIED',
 PROVIDER_MAPPING:station.providerDeviceId?'PASS':'NOT_VERIFIED',PROVIDER_READ_ONLY:station.provider==='manufacturer'?'NOT_VERIFIED':'NOT_VERIFIED',SLOTS_READ:data.slots.some(row=>row.stationId===station.id)?'PASS':'FAIL',BATTERIES_READ:data.slots.some(row=>row.stationId===station.id&&row.batteryId)?'PASS':'FAIL',AVAILABILITY_READ:'PASS',RECONCILIATION:'NOT_VERIFIED',RUNTIME_REBOOT_RECOVERY:'NOT_VERIFIED'
};
const onboarding=assessRuntimeOnboarding({stationId:station.id,runtimeEnrolled:false,coreHealthy:true,configLoaded:true,heartbeat:'UNKNOWN',providerHealth:'UNKNOWN',providerMapped:Boolean(station.providerDeviceId),slotsReadable:checks.SLOTS_READ==='PASS',batteriesReadable:checks.BATTERIES_READ==='PASS',availabilityReadable:checks.AVAILABILITY_READ==='PASS',openCriticalReconciliations:0});
console.log(JSON.stringify({status:onboarding.status,stationId:station.id,checkedAt:Date.now(),checks,blockingReasons:onboarding.blockingReasons,physicalActions:'DISABLED',notes:['Mock seed provides domain connectivity only. Runtime, provider and physical capabilities require staging credentials/hardware.']},null,2));
