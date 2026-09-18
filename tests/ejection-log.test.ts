import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {linkManufacturerStation} from '../core/manufacturer-sync';
import {suggestEjectionMatches,type EjectionLogEntry} from '../core/ejection-log';

const pricing={id:'pr',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000};

test('suggestEjectionMatches pairs the oldest uncertain rental with the earliest eligible log entry, never reusing a PID',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});d.stations.push({id:'s',publicId:'s',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:2});
 const link=linkManufacturerStation(d,'s','BAJIE','EXT-1',0);
 const base={customerId:'c',partnerId:'p',stationId:'s',batteryId:null,returnStationId:null,state:'EJECTING' as const,paymentState:'AUTHORIZED' as const,physicalState:'UNKNOWN' as const,startedAt:null,returnedAt:null,deadline:null,pricing,amountCents:0,commissionCents:0,error:null,simulatedMinutes:0};
 d.rentals.push({...base,id:'r1',createdAt:100,idempotencyKey:'k1'},{...base,id:'r2',createdAt:200,idempotencyKey:'k2'});
 d.events.push({id:'e1',rentalId:'r1',at:100,type:'EJECTING',detail:'x'},{id:'e2',rentalId:'r2',at:200,type:'EJECTING',detail:'x'});
 const entries:EjectionLogEntry[]=[
  {pid:'p1',stationExternalId:'EXT-1',slot:1,batteryId:'bat-1',operator:'op',operatedAt:150},
  {pid:'p2',stationExternalId:'EXT-1',slot:2,batteryId:'bat-2',operator:'op',operatedAt:250},
  {pid:'p3',stationExternalId:'OTHER-STATION',slot:1,batteryId:'bat-9',operator:'op',operatedAt:150},
 ];
 const matches=suggestEjectionMatches(d,link,entries);
 assert.deepEqual(matches.map(m=>[m.rentalId,m.batteryId,m.pid]),[['r1','bat-1','p1'],['r2','bat-2','p2']]);
});

test('a log entry from before the rental started ejecting is never offered, so an unrelated earlier pop leaves it unmatched',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});d.stations.push({id:'s',publicId:'s',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:1});
 const link=linkManufacturerStation(d,'s','BAJIE','EXT-1',0);
 d.rentals.push({id:'r1',customerId:'c',partnerId:'p',stationId:'s',batteryId:null,returnStationId:null,state:'EJECTING',paymentState:'AUTHORIZED',physicalState:'UNKNOWN',createdAt:200,startedAt:null,returnedAt:null,deadline:null,pricing,amountCents:0,commissionCents:0,idempotencyKey:'k1',error:null,simulatedMinutes:0});
 d.events.push({id:'e1',rentalId:'r1',at:200,type:'EJECTING',detail:'x'});
 const matches=suggestEjectionMatches(d,link,[{pid:'stale',stationExternalId:'EXT-1',slot:1,batteryId:'bat-old',operator:'op',operatedAt:100}]);
 assert.equal(matches.length,0);
});

test('a rental whose physicalState is no longer UNKNOWN is never offered a match',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});d.stations.push({id:'s',publicId:'s',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:1});
 const link=linkManufacturerStation(d,'s','BAJIE','EXT-1',0);
 d.rentals.push({id:'r1',customerId:'c',partnerId:'p',stationId:'s',batteryId:'bat-1',returnStationId:null,state:'ACTIVE',paymentState:'AUTHORIZED',physicalState:'EJECTED',createdAt:100,startedAt:100,returnedAt:null,deadline:null,pricing,amountCents:0,commissionCents:0,idempotencyKey:'k1',error:null,simulatedMinutes:0});
 d.events.push({id:'e1',rentalId:'r1',at:100,type:'EJECTING',detail:'x'});
 const matches=suggestEjectionMatches(d,link,[{pid:'p1',stationExternalId:'EXT-1',slot:1,batteryId:'bat-1',operator:'op',operatedAt:150}]);
 assert.equal(matches.length,0);
});
