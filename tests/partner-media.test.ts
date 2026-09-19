import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {dashboard} from '../core/queries';
import type {StationMedia} from '../core/media';

const media=(id:string,targetStationIds:string[]):StationMedia=>({id,name:id,kind:'IMAGE',uri:'https://example.test/'+id+'.png',checksum:id,durationMs:5000,status:'PUBLISHED',startsAt:null,endsAt:null,targetStationIds,createdAt:1,updatedAt:1});

test('a partner admin sees only media aimed exclusively at their own stations — never global ads nor another tenant’s',()=>{
 const d=seedData('x');
 const mine=d.stations.find(s=>s.partnerId==='partner-a')!,theirs=d.stations.find(s=>s.partnerId==='partner-b')!;
 d.media=[media('global',[]),media('mine',[mine.id]),media('theirs',[theirs.id]),media('mixed',[mine.id,theirs.id])];
 const own=dashboard(d,{id:'partner-demo',role:'PARTNER_ADMIN',partnerId:'partner-a'}).media.map(m=>m.id);
 assert.deepEqual(own,['mine']);
 assert.deepEqual(dashboard(d,{id:'partner_user',role:'PARTNER_USER',partnerId:'partner-a'}).media,[],'read-only partner users get no media console');
 assert.equal(dashboard(d,{id:'admin-demo',role:'SUPER_ADMIN',partnerId:null}).media.length,4);
});
