import test from 'node:test';import assert from 'node:assert/strict';import {emptyData} from '../core/types';import {createStation,publicQrUrl,setStripeTerminalLocation} from '../core/station-admin';import {activePlaylist,validatePlaylist} from '../core/media';
test('admin station creation provisions empty slots and unique public QR',()=>{const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});const s=createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3});assert.equal(d.slots.filter(x=>x.stationId===s.id).length,3);assert.equal(publicQrUrl('https://batyeo.test/','new-station'),'https://batyeo.test/rent/new-station');assert.throws(()=>createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3}));});
test('setStripeTerminalLocation assigns, clears and rejects a malformed Location ID',()=>{
 const d=emptyData();d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});d.venues.push({id:'v',partnerId:'p',name:'V',city:'Paris',address:'A',category:'Bar',hours:'24/7'});
 const s=createStation(d,{partnerId:'p',venueId:'v',publicId:'new-station',capacity:3});
 assert.equal(s.stripeTerminalLocationId,null);
 setStripeTerminalLocation(d,s.id,'tml_ABC123');
 assert.equal(s.stripeTerminalLocationId,'tml_ABC123');
 setStripeTerminalLocation(d,s.id,null);
 assert.equal(s.stripeTerminalLocationId,null);
 assert.throws(()=>setStripeTerminalLocation(d,s.id,'not-a-location-id'),/Location Stripe invalide/);
 assert.throws(()=>setStripeTerminalLocation(d,'missing',null),/Station introuvable/);
});
test('media playlist filters station and schedule and rejects unsafe media',()=>{const p={version:1,checksum:'x',issuedAt:0,items:[{id:'1',name:'Ad',kind:'VIDEO' as const,uri:'https://cdn.test/ad.mp4',checksum:'h',durationMs:5000,status:'PUBLISHED' as const,startsAt:null,endsAt:null,targetStationIds:['s'],createdAt:0}]};assert.equal(activePlaylist(p,'s').length,1);assert.equal(activePlaylist(p,'other').length,0);assert.equal(validatePlaylist(p),p);assert.throws(()=>validatePlaylist({...p,items:[{...p.items[0],uri:'http://unsafe'}]}));});
