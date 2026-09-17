import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTranslations,missingStringKeys,resolveStrings,RUNTIME_STRING_KEYS,MAX_RUNTIME_LOCALES,type RuntimeTranslations} from '../core/i18n';

function pack(overrides:Partial<RuntimeTranslations>={}):RuntimeTranslations {
 return {
  defaultLocale:'fr-FR',
  available:[{code:'fr',label:'Français',locale:'fr-FR'},{code:'en',label:'English',locale:'en-US'}],
  strings:{'fr-FR':{scanQr:'Scannez le QR',close:'Fermer'},'en-US':{scanQr:'Scan the QR'}},
  ...overrides,
 };
}

test('validateTranslations accepts a well-formed pack',()=>{
 assert.deepEqual(validateTranslations(pack()),pack());
});
test('validateTranslations rejects a blank default locale',()=>{
 assert.throws(()=>validateTranslations(pack({defaultLocale:'  '})),/default locale/i);
});
test('validateTranslations rejects an empty or oversized locale list',()=>{
 assert.throws(()=>validateTranslations(pack({available:[]})),/Invalid runtime locale list/);
 const tooMany=Array.from({length:MAX_RUNTIME_LOCALES+1},(_,i)=>({code:`l${i}`,label:`L${i}`,locale:`l${i}-XX`}));
 assert.throws(()=>validateTranslations(pack({available:tooMany,defaultLocale:'l0-XX',strings:{'l0-XX':{close:'x'}}})),/Invalid runtime locale list/);
});
test('validateTranslations rejects a locale entry missing code, label or locale',()=>{
 assert.throws(()=>validateTranslations(pack({available:[{code:'',label:'Français',locale:'fr-FR'}]})),/Invalid runtime locale entry/);
});
test('validateTranslations rejects duplicate locale codes',()=>{
 const duplicated=pack({available:[{code:'fr',label:'Français',locale:'fr-FR'},{code:'fr2',label:'Français bis',locale:'fr-FR'}]});
 assert.throws(()=>validateTranslations(duplicated),/Duplicate runtime locale/);
});
test('validateTranslations rejects a default locale absent from the available list',()=>{
 assert.throws(()=>validateTranslations(pack({defaultLocale:'de-DE'})),/Default locale absent/);
});
test('validateTranslations rejects an available locale with no dictionary',()=>{
 const missingDictionary=pack({strings:{'fr-FR':{scanQr:'Scannez le QR'}}});
 assert.throws(()=>validateTranslations(missingDictionary),/Missing translation dictionary for en-US/);
});
test('validateTranslations rejects non-string or oversized translation values',()=>{
 assert.throws(()=>validateTranslations(pack({strings:{'fr-FR':{scanQr:123 as unknown as string},'en-US':{scanQr:'Scan'}}})),/Invalid translation value/);
 const tooLong='x'.repeat(2001);
 assert.throws(()=>validateTranslations(pack({strings:{'fr-FR':{scanQr:tooLong},'en-US':{scanQr:'Scan'}}})),/Invalid translation value/);
});
test('validateTranslations rejects an empty default locale dictionary',()=>{
 assert.throws(()=>validateTranslations(pack({strings:{'fr-FR':{},'en-US':{scanQr:'Scan'}}})),/Default locale dictionary is empty/);
});

test('missingStringKeys reports every unfilled or blank key and none once complete',()=>{
 const sparse=pack();
 const missing=missingStringKeys(sparse,'en-US');
 assert.ok(missing.includes('close'));
 assert.ok(!missing.includes('scanQr'));
 assert.equal(missing.length,RUNTIME_STRING_KEYS.length-1);
 const blank=pack({strings:{'fr-FR':{scanQr:'Scannez le QR',close:'   '}}});
 assert.ok(missingStringKeys(blank,'fr-FR').includes('close'));
 const complete=pack({strings:{'fr-FR':Object.fromEntries(RUNTIME_STRING_KEYS.map(k=>[k,'x']))}});
 assert.deepEqual(missingStringKeys(complete,'fr-FR'),[]);
});
test('missingStringKeys treats an unconfigured locale as fully missing',()=>{
 assert.equal(missingStringKeys(pack(),'de-DE').length,RUNTIME_STRING_KEYS.length);
});

test('resolveStrings falls back to the default locale for keys a target locale has not translated',()=>{
 const resolved=resolveStrings(pack(),'en-US');
 assert.equal(resolved.scanQr,'Scan the QR');
 assert.equal(resolved.close,'Fermer');
});
test('resolveStrings returns only default-locale strings for a locale with no dictionary at all',()=>{
 const resolved=resolveStrings(pack(),'de-DE');
 assert.deepEqual(resolved,{scanQr:'Scannez le QR',close:'Fermer'});
});
test('resolveStrings only overrides keys the target locale actually has; other default keys stay intact',()=>{
 const resolved=resolveStrings(pack({strings:{'fr-FR':{scanQr:'Scannez le QR',close:'Fermer'},'en-US':{scanQr:'Scan'}}}),'en-US');
 assert.equal(resolved.scanQr,'Scan');
 assert.equal(resolved.close,'Fermer');
});
