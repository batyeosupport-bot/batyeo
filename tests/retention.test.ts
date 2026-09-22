import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {purgeSettledWebhookEvents,WEBHOOK_RETENTION_MS} from '../core/retention';

const event=(id:string,status:'RECEIVED'|'PROCESSED'|'FAILED'|'UNTRUSTED',receivedAt:number)=>
 ({id,source:'stripe',externalId:id,payloadHash:'h',payload:{},receivedAt,processedAt:null,status,error:null});

test('only webhook deliveries already processed and older than the window are dropped',()=>{
 const now=Date.now(),old=now-WEBHOOK_RETENTION_MS-1,recent=now-1000;
 const d=emptyData();
 d.webhookEvents=[event('old-processed','PROCESSED',old),event('recent-processed','PROCESSED',recent),
  event('old-failed','FAILED',old),event('old-received','RECEIVED',old),event('old-untrusted','UNTRUSTED',old)];
 assert.equal(purgeSettledWebhookEvents(d,now),1);
 assert.deepEqual(d.webhookEvents.map(e=>e.id),['recent-processed','old-failed','old-received','old-untrusted']);
});

test('a delivery still inside the window keeps guarding against a Stripe retry',()=>{
 const now=Date.now(),d=emptyData();
 d.webhookEvents=[event('evt','PROCESSED',now-3*24*60*60*1000)];
 assert.equal(purgeSettledWebhookEvents(d,now),0);
 assert.equal(d.webhookEvents.length,1);
});

test('purging an empty ledger is a no-op',()=>{
 const d=emptyData();
 assert.equal(purgeSettledWebhookEvents(d,Date.now()),0);
});
