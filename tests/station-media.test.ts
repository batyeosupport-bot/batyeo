import test from 'node:test';import assert from 'node:assert/strict';import {emptyData} from '../core/types';import {createStation,publicQrUrl,setStripeTerminalLocation,blockStationRentals,unblockStationRentals,archiveStation,restoreStation,relocateStation} from '../core/station-admin';import {activePlaylist,validatePlaylist} from '../core/media';
import {RentalEngine} from '../core/rental';
test('admin station creation provisions empty slots and unique public QR',()=>{const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});const s=createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3});assert.equal(d.slots.filter(x=>x.stationId===s.id).length,3);assert.equal(publicQrUrl('https://batyeo.test/','new-station'),'https://batyeo.test/rent/new-station');assert.throws(()=>createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3}));});
test('setStripeTerminalLocation assigns, clears and rejects a malformed Location ID, bumping its own timestamp each time',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});
 const s=createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3});
 assert.equal(s.stripeTerminalLocationId,null);
 setStripeTerminalLocation(d,s.id,'tml_ABC123',100);
 assert.equal(s.stripeTerminalLocationId,'tml_ABC123');
 assert.equal(s.stripeTerminalLocationUpdatedAt,100);
 setStripeTerminalLocation(d,s.id,null,200);
 assert.equal(s.stripeTerminalLocationId,null);
 assert.equal(s.stripeTerminalLocationUpdatedAt,200);
 assert.throws(()=>setStripeTerminalLocation(d,s.id,'not-a-location-id'),/Location Stripe invalide/);
 assert.throws(()=>setStripeTerminalLocation(d,'missing',null),/Station introuvable/);
});
test('blockStationRentals/unblockStationRentals gate new rentals independently of online/failure',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});
 const s=createStation(d,{partnerId:'p',venueId:'v',publicId:'blockable',capacity:1});s.online=true;
 d.batteries.push({id:'bat-1',charge:100,status:'AVAILABLE'});d.slots.find(x=>x.stationId===s.id)!.batteryId='bat-1';
 d.pricing.push({id:'pr',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000});
 const engine=new RentalEngine();
 assert.ok(engine.create(d,'cust-1','blockable','key-1'));
 blockStationRentals(d,s.id,'Maintenance capteur');
 assert.equal(s.rentalsBlocked,true);assert.equal(s.rentalsBlockedReason,'Maintenance capteur');
 assert.throws(()=>engine.create(d,'cust-2','blockable','key-2'),/temporairement bloquée/);
 assert.throws(()=>blockStationRentals(d,s.id,'   '),/Motif de blocage invalide/);
 assert.throws(()=>blockStationRentals(d,'missing','x'),/Station introuvable/);
 unblockStationRentals(d,s.id);
 assert.equal(s.rentalsBlocked,false);assert.equal(s.rentalsBlockedReason,null);
 assert.ok(engine.create(d,'cust-2','blockable','key-2'));
 assert.throws(()=>unblockStationRentals(d,'missing'),/Station introuvable/);
});
function twoVenues(){
 const d=emptyData();
 d.partners.push({id:'p1',name:'Client A',city:'Paris',commissionBps:1000},{id:'p2',name:'Client B',city:'Lyon',commissionBps:1000});
 d.venues.push({id:'v1',partnerId:'p1',name:'Bar A',city:'Paris',address:'1 rue A',category:'Bar',hours:'24/7'},{id:'v2',partnerId:'p1',name:'Hôtel A2',city:'Paris',address:'2 rue A',category:'Hôtel',hours:'24/7'},{id:'v3',partnerId:'p2',name:'Club B',city:'Lyon',address:'3 rue B',category:'Club',hours:'20:00-05:00'});
 d.pricing.push({id:'pr',hourlyCents:200,capCents:800,depositCents:2000,deadlineHours:48,commissionBps:2000});
 return d;
}
test('archiving keeps the station and its history but is refused while a rental is still open',()=>{
 const d=twoVenues();const s=createStation(d,{partnerId:'p1',venueId:'v1',publicId:'retirable',capacity:1});
 d.rentals.push({id:'r1',customerId:'c1',stationId:s.id,partnerId:'p1',batteryId:null,state:'ACTIVE',createdAt:1,startedAt:1,returnedAt:null,deadline:null,simulatedMinutes:0,idempotencyKey:'k',pricing:d.pricing[0],error:null,returnStationId:null,amountCents:0,commissionCents:0});
 assert.throws(()=>archiveStation(d,s.id),/location est encore en cours/);
 d.rentals[0].state='COMPLETED';
 archiveStation(d,s.id,1234);
 assert.equal(s.archivedAt,1234);
 assert.equal(d.stations.length,1,'la ligne est conservée, jamais supprimée');
 assert.equal(d.rentals.length,1,'l’historique reste rattaché');
 assert.equal(archiveStation(d,s.id,9999).archivedAt,1234,'archiver deux fois ne réécrit pas la date');
 restoreStation(d,s.id);assert.equal(s.archivedAt,null);
 assert.throws(()=>archiveStation(d,'missing'),/Station introuvable/);
});
test('relocating a station moves its venue and partner, keeps the manufacturer cabinet and clears the Stripe Location',()=>{
 const d=twoVenues();const s=createStation(d,{partnerId:'p1',venueId:'v1',publicId:'movable',capacity:1});
 s.providerDeviceId='DTA55480';s.provider='manufacturer';
 setStripeTerminalLocation(d,s.id,'tml_paris',10);
 relocateStation(d,s.id,'v3',5000);
 assert.equal(s.venueId,'v3');
 assert.equal(s.partnerId,'p2','le partenaire suit l’établissement d’accueil');
 assert.equal(s.providerDeviceId,'DTA55480','même borne physique, même identifiant fabricant');
 assert.equal(s.stripeTerminalLocationId,null,'l’adresse a changé : la Location Stripe doit être réassignée');
 assert.equal(s.stripeTerminalLocationUpdatedAt,5000);
 assert.throws(()=>relocateStation(d,s.id,'missing'),/Établissement introuvable/);
});
test('relocating is refused while a rental is still open on that station',()=>{
 const d=twoVenues();const s=createStation(d,{partnerId:'p1',venueId:'v1',publicId:'busy',capacity:1});
 d.rentals.push({id:'r1',customerId:'c1',stationId:s.id,partnerId:'p1',batteryId:null,state:'ACTIVE',createdAt:1,startedAt:1,returnedAt:null,deadline:null,simulatedMinutes:0,idempotencyKey:'k',pricing:d.pricing[0],error:null,returnStationId:null,amountCents:0,commissionCents:0});
 assert.throws(()=>relocateStation(d,s.id,'v2'),/location est encore en cours/);
});
test('media playlist filters station and schedule and rejects unsafe media',()=>{const p={version:1,checksum:'x',issuedAt:0,items:[{id:'1',name:'Ad',kind:'VIDEO' as const,uri:'https://cdn.test/ad.mp4',checksum:'h',durationMs:5000,status:'PUBLISHED' as const,startsAt:null,endsAt:null,targetStationIds:['s'],createdAt:0}]};assert.equal(activePlaylist(p,'s').length,1);assert.equal(activePlaylist(p,'other').length,0);assert.equal(validatePlaylist(p),p);assert.throws(()=>validatePlaylist({...p,items:[{...p.items[0],uri:'http://unsafe'}]}));});
