import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {displayConfigFor} from '../core/queries';

function baseData(){
 const d=emptyData();
 d.partners.push({id:'p',name:'P',city:'Paris',commissionBps:1000});
 d.venues.push({id:'v',partnerId:'p',name:'Le Bar',city:'Paris',address:'1 rue A',category:'Bar',hours:'24/7'});
 d.stations.push({id:'station-1',publicId:'station-1-public',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:8});
 d.stations.push({id:'station-2',publicId:'station-2-public',venueId:'v',partnerId:'p',online:true,failure:'none',capacity:8});
 return d;
}

test('displayConfigFor throws for an unknown station or venue',()=>{
 const d=baseData();
 assert.throws(()=>displayConfigFor(d,'missing'),/Station introuvable/);
 d.stations[0].venueId='missing-venue';
 assert.throws(()=>displayConfigFor(d,'station-1'),/Établissement introuvable/);
});

test('displayConfigFor falls back to defaults when no admin config was ever saved',()=>{
 const d=baseData();
 const config=displayConfigFor(d,'station-1');
 assert.equal(config.venueName,'Le Bar');
 assert.equal(config.locale,'fr-FR');
 assert.equal(config.idleContent,'');
 assert.equal(config.maintenanceBanner,null);
 assert.equal(config.refreshIntervalMs,15_000);
 assert.deepEqual(config.featureFlags,{});
 assert.equal(config.translations,null);
 assert.equal(config.version,1);
});

test('displayConfigFor resolves a station by its public ID as well as its internal ID',()=>{
 const d=baseData();
 assert.equal(displayConfigFor(d,'station-1-public').venueName,displayConfigFor(d,'station-1').venueName);
});

test('displayConfigFor playlist only includes media targeted at, or broadcast to, this station',()=>{
 const d=baseData();
 d.media.push(
  {id:'m-broadcast',name:'Broadcast',kind:'IMAGE',uri:'https://cdn.test/a.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:[],createdAt:1},
  {id:'m-station-1',name:'Only station 1',kind:'IMAGE',uri:'https://cdn.test/b.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:['station-1'],createdAt:2},
  {id:'m-station-2',name:'Only station 2',kind:'IMAGE',uri:'https://cdn.test/c.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:['station-2'],createdAt:3},
  {id:'m-draft',name:'Draft',kind:'IMAGE',uri:'https://cdn.test/d.png',checksum:'h',durationMs:5000,status:'DRAFT',startsAt:null,endsAt:null,targetStationIds:[],createdAt:4},
 );
 const config=displayConfigFor(d,'station-1');
 assert.deepEqual([...config.advertisingSlots].sort(),['m-broadcast','m-station-1']);
});

test('displayConfigFor version is the latest of the saved display config and every media update, never lower than 1',()=>{
 const d=baseData();
 assert.equal(displayConfigFor(d,'station-1').version,1);
 d.media.push({id:'m1',name:'Ad',kind:'IMAGE',uri:'https://cdn.test/a.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:[],createdAt:10,updatedAt:50});
 assert.equal(displayConfigFor(d,'station-1').version,50);
 d.displayConfigs.push({id:'dc-1',stationId:'station-1',idleContent:'Scannez',supportContact:'aide@batyeo.fr',maintenanceBanner:null,locale:'en-US',refreshIntervalMs:20_000,featureFlags:{},translations:null,updatedAt:30});
 assert.equal(displayConfigFor(d,'station-1').version,50);
 d.displayConfigs[0].updatedAt=999;
 assert.equal(displayConfigFor(d,'station-1').version,999);
});

test('displayConfigFor never mixes another station\'s saved config, media, or targeted ads',()=>{
 const d=baseData();
 d.displayConfigs.push({id:'dc-2',stationId:'station-2',idleContent:'Station 2 only',supportContact:'x',maintenanceBanner:'Maintenance',locale:'en-US',refreshIntervalMs:5000,featureFlags:{beta:true},translations:null,updatedAt:20});
 d.media.push({id:'m-station-2',name:'Only station 2',kind:'IMAGE',uri:'https://cdn.test/c.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:['station-2'],createdAt:1});
 const config=displayConfigFor(d,'station-1');
 assert.equal(config.idleContent,'');
 assert.equal(config.locale,'fr-FR');
 assert.deepEqual(config.advertisingSlots,[]);
});

test('displayConfigFor exposes the assigned Stripe Terminal Location and defaults to null when unset',()=>{
 const d=baseData();
 assert.equal(displayConfigFor(d,'station-1').stripeTerminalLocationId,null);
 d.stations[0].stripeTerminalLocationId='tml_ABC123';
 assert.equal(displayConfigFor(d,'station-1').stripeTerminalLocationId,'tml_ABC123');
 assert.equal(displayConfigFor(d,'station-2').stripeTerminalLocationId,null);
});
test('displayConfigFor version bumps when the Stripe Terminal Location changes, so a runtime never gets stuck on a stale one',()=>{
 const d=baseData();
 const before=displayConfigFor(d,'station-1').version;
 d.stations[0].stripeTerminalLocationId='tml_ABC123';
 d.stations[0].stripeTerminalLocationUpdatedAt=before+100;
 const after=displayConfigFor(d,'station-1');
 assert.equal(after.stripeTerminalLocationId,'tml_ABC123');
 assert.equal(after.version,before+100);
});

test('displayConfigFor excludes media outside its scheduling window',()=>{
 const d=baseData();
 const now=Date.now();
 d.media.push(
  {id:'m-future',name:'Future',kind:'IMAGE',uri:'https://cdn.test/a.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:now+100_000,endsAt:null,targetStationIds:[],createdAt:1},
  {id:'m-past',name:'Past',kind:'IMAGE',uri:'https://cdn.test/b.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:now-1,targetStationIds:[],createdAt:1},
  {id:'m-live',name:'Live',kind:'IMAGE',uri:'https://cdn.test/c.png',checksum:'h',durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds:[],createdAt:1},
 );
 assert.deepEqual(displayConfigFor(d,'station-1').advertisingSlots,['m-live']);
});
