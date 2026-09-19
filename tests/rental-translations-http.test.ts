import test from 'node:test';
import assert from 'node:assert/strict';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
import {validateTranslations} from '../core/i18n';
import {createApi} from '../server/http';
import type {Repository} from '../core/repository';
import type {Data} from '../core/types';

class MemoryRepository implements Repository {
 constructor(public data:Data){}
 async read(){return structuredClone(this.data);}
 async transaction<T>(mutate:(d:Data)=>T){const next=structuredClone(this.data);const result=mutate(next);validateData(next);this.data=next;return result;}
}
const origin='https://batyeo.test';
function get(repo:Repository,path:string){
 const request=new Request(origin+'/api/core/'+path,{headers:{origin}});
 return createApi(repo,{demo:true,allowLegacyCredentials:true},{}).GET(request,{params:Promise.resolve({path:path.split('/')})});
}

test('translations/:publicId returns null translations, cleanly, for a station nobody has configured yet',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const r=await get(repo,'translations/paris-demo');
 assert.equal(r.status,200);
 const body=await r.json() as {locale:string;translations:unknown};
 assert.equal(body.locale,'fr-FR');
 assert.equal(body.translations,null,'no admin config yet — the web page must fall back to its own built-in French, not crash');
});

test('translations/:publicId returns the configured pack once an admin has published one, and works by the public QR id too',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const translations=validateTranslations({defaultLocale:'fr-FR',available:[{code:'fr',label:'Français',locale:'fr-FR'},{code:'en',label:'English',locale:'en-US'}],strings:{'fr-FR':{web_intro_cta:'PRENDRE UNE BATTERIE'},'en-US':{web_intro_cta:'RENT A BATTERY'}}});
 repo.data.displayConfigs.push({id:'dc-1',stationId:'station-paris',idleContent:'',supportContact:'',maintenanceBanner:null,locale:'fr-FR',refreshIntervalMs:15000,featureFlags:{},translations,updatedAt:1000});
 const byPublicId=await get(repo,'translations/paris-demo');
 assert.equal(byPublicId.status,200);
 const body=await byPublicId.json() as {translations:{available:{locale:string}[];strings:Record<string,Record<string,string>>}};
 assert.equal(body.translations.available.length,2);
 assert.equal(body.translations.strings['en-US'].web_intro_cta,'RENT A BATTERY');
 const byInternalId=await get(repo,'translations/station-paris');
 assert.equal(byInternalId.status,200);
});

test('translations/:publicId is a clean 404 DomainError for an unknown station, never the generic 503 catch-all',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const r=await get(repo,'translations/does-not-exist');
 assert.equal(r.status,404);
 const body=await r.json() as {error:string};
 assert.match(body.error,/Station introuvable/);
});

test('translations/:publicId requires no authentication — a customer scanning a QR code is never logged in',async()=>{
 const repo=new MemoryRepository(seedData('hash'));
 const request=new Request(origin+'/api/core/translations/paris-demo',{headers:{origin}});
 const r=await createApi(repo,{demo:true,allowLegacyCredentials:true},{}).GET(request,{params:Promise.resolve({path:['translations','paris-demo']})});
 assert.equal(r.status,200);
});
