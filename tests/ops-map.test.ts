import test from 'node:test';import assert from 'node:assert/strict';import {mapStations} from '../core/station-map';import {evaluateAlerts} from '../core/ops-alerts';import {emptyData} from '../core/types';
test('station map exposes return eligibility and safe fallback',()=>{const stations=[{publicId:'a',name:'A',city:'Paris',online:true,available:2,freeSlots:1,latitude:48.85,longitude:2.35},{publicId:'b',name:'B',city:'Lyon',online:false,available:1,freeSlots:1}];assert.equal(mapStations(stations).find(x=>x.publicId==='a')?.canReturn,true);assert.equal(mapStations(stations).find(x=>x.publicId==='b')?.canReturn,false);assert.equal(mapStations(stations,{latitude:48.85,longitude:2.35}).length,1);});
test('ops alerts are derived from Core state',()=>{const d=emptyData();d.stations.push({id:'s',publicId:'s',venueId:'v',partnerId:'p',online:false,failure:'none',capacity:1});const alerts=evaluateAlerts(d,10);assert.ok(alerts.some(a=>a.kind==='STATION_OFFLINE'));assert.ok(alerts.some(a=>a.kind==='NO_BATTERY'));});
test('overdue alert escalates to CRITICAL once the deposit is eligible for a definitive loss',()=>{
 const d=emptyData();const deadline=48*3600000;
 d.rentals.push({id:'r1',customerId:'c',partnerId:'p',stationId:'s',batteryId:'b',returnStationId:null,state:'OVERDUE',paymentState:'AUTHORIZED',physicalState:'EJECTED',createdAt:0,startedAt:0,returnedAt:null,deadline,pricing:{id:'x',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000},amountCents:0,commissionCents:0,idempotencyKey:'k',error:null,simulatedMinutes:0});
 assert.equal(evaluateAlerts(d,deadline+3600000).find(a=>a.kind==='OVERDUE')?.severity,'MEDIUM');
 assert.equal(evaluateAlerts(d,deadline+96*3600000).find(a=>a.kind==='OVERDUE')?.severity,'CRITICAL');
});
