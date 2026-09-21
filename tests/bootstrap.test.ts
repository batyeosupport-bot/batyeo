import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../core/types';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {bootstrapOperator,retireDemoAccounts} from '../core/accounts';
import {actorForUser} from '../core/security';
import {DEFAULT_PRICING} from '../core/pricing';

test('an empty database gets a real owner and the pricing grid, and nothing that looks like demo data',()=>{
 const d=emptyData();
 const user=bootstrapOperator(d,{email:'  Fondateur@Batyeo.FR ',name:'Anis'},'hash',{...DEFAULT_PRICING});
 assert.equal(user.email,'fondateur@batyeo.fr');assert.equal(user.role,'SUPER_ADMIN');assert.equal(user.partnerId,null);
 assert.equal(d.users.length,1);assert.equal(d.pricing.length,1);
 assert.equal(d.stations.length+d.partners.length+d.rentals.length+d.batteries.length,0,'no fixture of any kind');
 validateData(d);
});

test('bootstrap refuses invalid or demo-looking owners, and refuses a database that already has a real account',()=>{
 for(const email of ['pas-un-email','x@batyeo.demo',''])assert.throws(()=>bootstrapOperator(emptyData(),{email,name:'Anis'},'h',{...DEFAULT_PRICING}),/invalide/);
 assert.throws(()=>bootstrapOperator(emptyData(),{email:'a@b.fr',name:' '},'h',{...DEFAULT_PRICING}),/Nom invalide/);
 const live=emptyData();bootstrapOperator(live,{email:'a@b.fr',name:'Anis'},'h',{...DEFAULT_PRICING});
 const before=JSON.stringify(live);
 assert.throws(()=>bootstrapOperator(live,{email:'other@b.fr',name:'Autre'},'h',{...DEFAULT_PRICING}),/déjà des comptes réels/);
 assert.equal(JSON.stringify(live),before,'a refused bootstrap leaves live data untouched');
});

test('on a database seeded with the demo, a real owner is added and the demo accounts are then locked out for good',()=>{
 const d=seedData('x');const demoCount=d.users.length;
 const owner=bootstrapOperator(d,{email:'fondateur@batyeo.fr',name:'Anis'},'hash',{...DEFAULT_PRICING});
 assert.equal(d.users.length,demoCount+1);assert.equal(d.pricing.length,1,'the existing grid is kept, never duplicated');
 const demo=d.users.find(u=>u.email==='admin@batyeo.demo')!;
 d.sessions.push({id:'demo-session',userId:demo.id,expiresAt:Date.now()+100_000,authVersion:0});
 assert.ok(actorForUser(d,demo),'before retiring, a demo admin can still act');
 const {retired}=retireDemoAccounts(d);
 assert.equal(retired,demoCount);
 assert.equal(actorForUser(d,demo),undefined,'a retired demo account cannot act, even with a live session');
 assert.ok(!d.sessions.some(s=>s.userId===demo.id));
 assert.ok(actorForUser(d,d.users.find(u=>u.id===owner.id)!),'the real owner is untouched');
 assert.equal(retireDemoAccounts(d).retired,0,'idempotent');
 validateData(d);
});

test('retiring the demo accounts is refused while it would lock everyone out',()=>{
 const d=seedData('x');
 assert.throws(()=>retireDemoAccounts(d),/vrai administrateur/);
 assert.ok(d.users.every(u=>u.disabledAt==null),'nothing was disabled by the refused call');
 const owner=bootstrapOperator(d,{email:'fondateur@batyeo.fr',name:'Anis'},'h',{...DEFAULT_PRICING});
 owner.disabledAt=Date.now();
 assert.throws(()=>retireDemoAccounts(d),/vrai administrateur/,'a disabled owner does not count either');
});
