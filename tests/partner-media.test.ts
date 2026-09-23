import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {dashboard} from '../core/queries';
import type {StationMedia} from '../core/media';

const media=(id:string,targetStationIds:string[]):StationMedia=>({id,name:id,kind:'IMAGE',uri:'https://example.test/'+id+'.png',checksum:id,durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds,createdAt:1,updatedAt:1});

test('the kiosk screen is BATYEO’s: partners never receive the media library, not even ads aimed at their own stations',()=>{
 const d=seedData('x');
 const mine=d.stations.find(s=>s.partnerId==='partner-a')!,theirs=d.stations.find(s=>s.partnerId==='partner-b')!;
 d.media=[media('global',[]),media('mine',[mine.id]),media('theirs',[theirs.id])];
 assert.deepEqual(dashboard(d,{id:'partner-demo',role:'PARTNER_ADMIN',partnerId:'partner-a'}).media,[]);
 assert.deepEqual(dashboard(d,{id:'partner_user',role:'PARTNER_USER',partnerId:'partner-a'}).media,[]);
 assert.equal(dashboard(d,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null}).media.length,3);
});
