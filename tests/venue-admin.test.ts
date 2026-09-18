import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {sha256} from '../core/security';
import {createVenue,updateVenue,setStripeTerminalLocation} from '../core/station-admin';
import {validateData} from '../core/invariants';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function call(repo:Repository,path:string,body:unknown,token:string){
 const request=new Request(origin+'/api/core/'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:`batyeo_session=${token}`},body:JSON.stringify(body)});
 return createApi(repo,{demo:true,allowLegacyCredentials:true},{}).POST(request,{params:Promise.resolve({path:path.split('/')})});
}
async function tokenFor(repo:MemoryRepository,role='SUPER_ADMIN'){
 const u=repo.data.users.find(u=>u.role===role)!;const token=crypto.randomUUID()+crypto.randomUUID();const digest=await sha256(token);
 repo.data.sessions.push({id:digest,userId:u.id,expiresAt:Date.now()+100000,authVersion:0});return token;
}
const paris=(d:Data)=>d.venues.find(v=>v.id==='venue-paris')!;

test('updateVenue corrige la fiche, normalise et laisse le partenaire intact',()=>{
 const d=seedData('hash');const before=paris(d).partnerId;
 const venue=updateVenue(d,'venue-paris',{name:'  Hôtel Corrigé  ',city:' Paris ',address:' 20 allée des blés ',category:'',hours:'',latitude:48.75,longitude:2.12});
 assert.equal(venue.name,'Hôtel Corrigé');assert.equal(venue.address,'20 allée des blés');
 assert.equal(venue.category,'Établissement','catégorie vide → valeur par défaut, comme à la création');
 assert.equal(venue.hours,'Non renseigné');
 assert.equal(venue.latitude,48.75);
 assert.equal(venue.partnerId,before,'le partenaire ne change jamais par cette porte');
 assert.equal(d.venues.length,3,'corrige la fiche, n’en crée pas une seconde');
 validateData(d);
});

test('updateVenue applique les mêmes règles de validité que createVenue',()=>{
 const d=seedData('hash');
 const valide={name:'Nom',city:'Ville',address:'Adresse',category:'',hours:''};
 for(const [champ,invalide] of [['name',{...valide,name:'   '}],['city',{...valide,city:''}],['address',{...valide,address:' '}],['latitude',{...valide,latitude:91}],['longitude',{...valide,longitude:-181}]] as const){
  assert.throws(()=>updateVenue(d,'venue-paris',invalide),`update refuse ${champ}`);
  assert.throws(()=>createVenue(d,{partnerId:'partner-a',...invalide}),`create refuse ${champ}`);
 }
 assert.equal(paris(d).name,'Hôtel Démo Paris','aucun refus ne laisse de trace');
 assert.throws(()=>updateVenue(d,'venue-fantome',valide),/Établissement introuvable/);
 validateData(d);
});

test('changer l’adresse détache la Location Stripe des bornes du lieu, la renommer non',()=>{
 const d=seedData('hash');
 setStripeTerminalLocation(d,'station-paris','tml_abc123',1000);
 const autre=d.stations.find(s=>s.id==='station-lille')!;setStripeTerminalLocation(d,autre.id,'tml_ailleurs',1000);
 const fiche={city:paris(d).city,address:paris(d).address,category:'Hôtel',hours:'24 h / 24'};
 updateVenue(d,'venue-paris',{...fiche,name:'Hôtel Rebaptisé'},2000);
 assert.equal(d.stations.find(s=>s.id==='station-paris')!.stripeTerminalLocationId,'tml_abc123','un simple renommage ne détache rien');
 updateVenue(d,'venue-paris',{...fiche,name:'Hôtel Rebaptisé',address:'2 rue Nouvelle'},3000);
 const station=d.stations.find(s=>s.id==='station-paris')!;
 assert.equal(station.stripeTerminalLocationId,null,'la Location désignait l’ancienne adresse');
 assert.equal(station.stripeTerminalLocationUpdatedAt,3000,'le kiosque doit repérer le changement à sa prochaine lecture');
 assert.equal(autre.stripeTerminalLocationId,'tml_ailleurs','les bornes d’un autre lieu ne bougent pas');
 validateData(d);
});

test('venue/update est journalisé, cloisonné par partenaire et refusé aux rôles sans réglages',async()=>{
 const repo=new MemoryRepository(seedData('hash'));const token=await tokenFor(repo);
 const fiche={name:'Hôtel Démo Paris',city:'Paris',address:'20 allée des blés',category:'Hôtel',hours:'24 h / 24'};
 assert.equal((await call(repo,'venue/update',{venueId:'venue-paris',...fiche},token)).status,200);
 assert.equal(repo.data.venues.find(v=>v.id==='venue-paris')!.address,'20 allée des blés');
 assert.match(repo.data.audits.at(-1)!.action,/Établissement modifié.*adresse/);
 assert.equal((await call(repo,'venue/update',{venueId:'venue-inconnu',...fiche},token)).status,404);
 assert.equal((await call(repo,'venue/update',{venueId:'venue-paris',...fiche},await tokenFor(repo,'OPERATIONS'))).status,403);
 // venue-lille appartient à partner-b : un PARTNER_ADMIN de partner-a ne doit pas même apprendre son existence.
 assert.equal((await call(repo,'venue/update',{venueId:'venue-lille',...fiche},await tokenFor(repo,'PARTNER_ADMIN'))).status,404);
 assert.equal(repo.data.venues.find(v=>v.id==='venue-lille')!.name,'Club Démo Lille');
});
