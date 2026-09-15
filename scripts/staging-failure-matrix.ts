import {seedData} from '../core/seed';
import {RentalEngine} from '../core/rental';
import {MockBatteryStationProvider} from '../core/providers';

const scenarios=['payment','ejection','timeout'] as const;
const results=scenarios.map((failure)=>{const data=seedData('demo-password');const station='station-paris';const provider=new MockBatteryStationProvider();provider.simulateFailure(data,station,failure);const before=provider.getAvailability(data,station);const rental=new RentalEngine().start(data,`failure-${failure}`,station,`failure-${failure}`,Date.now());const payment=data.payments.find(row=>row.rentalId===rental.id);return {failure,state:rental.state,paymentState:payment?.status??'UNKNOWN',batteryMoved:rental.batteryId!==null,availabilityUnchanged:provider.getAvailability(data,station)===before,authorizationReleased:(payment?.releasedCents??0)>0||failure==='payment'};});
const safe=results.every(result=>result.batteryMoved===false&&result.availabilityUnchanged&&result.state!=='ACTIVE'&&result.state!=='COMPLETED');
console.log(JSON.stringify({status:safe?'FAILURE_MATRIX_OK':'FAILURE_MATRIX_FAILED',physical:'DRY_RUN_ONLY',results},null,2));
if(!safe)process.exitCode=1;
