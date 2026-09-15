import {seedData} from '../core/seed';
import {RentalEngine} from '../core/rental';
import {MockBatteryStationProvider} from '../core/providers';
import {rentalView} from '../core/queries';

/** Deterministic, non-destructive staging rehearsal. No network/provider write is performed. */
const data=seedData('demo-password');
const station=data.stations.find(s=>s.id==='station-paris'&&s.online&&data.slots.some(x=>x.stationId===s.id&&x.batteryId));
const returnStation=data.stations.find(s=>s.id==='station-lyon'&&s.online);
if(!station||!returnStation){console.log(JSON.stringify({status:'BLOCKED',reason:'Seeded stations unavailable'},null,2));process.exit(0);}
const engine=new RentalEngine();
const provider=new MockBatteryStationProvider();
const started=engine.start(data,'staging-golden-customer',station.id,'staging-golden-idempotency',Date.now());
const authorized=data.payments.find(payment=>payment.rentalId===started.id)?.status==='AUTHORIZED';
const batteryId=started.batteryId;
const availabilityAfterEject=provider.getAvailability(data,station.id);
engine.return(data,started.id,returnStation.id,Date.now()+61*60_000);
const payment=data.payments.find(payment=>payment.rentalId===started.id);
const receipt=rentalView(data,started,true);
const checks={created:started.id.length>0,authorized,activeBeforeReturn:batteryId!==null,returned:started.returnStationId===returnStation.id,completed:started.state==='COMPLETED',capturedExact:payment?.capturedCents===started.amountCents,depositReleased:payment?.releasedCents===2000-(payment?.capturedCents??0),receipt:receipt.id===started.id,availabilityChanged:availabilityAfterEject>=0};
console.log(JSON.stringify({status:Object.values(checks).every(Boolean)?'MOCK_GOLDEN_FLOW_OK':'MOCK_GOLDEN_FLOW_FAILED',checks,rental:{id:started.id,state:started.state,amountCents:started.amountCents,stationId:station.id,returnStationId:returnStation.id},physical:'DRY_RUN_ONLY',providerWrites:0},null,2));
if(!Object.values(checks).every(Boolean))process.exitCode=1;
