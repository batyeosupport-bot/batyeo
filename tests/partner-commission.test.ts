import test from 'node:test';
import assert from 'node:assert/strict';
import {RentalEngine} from '../core/rental';
import {setPartnerCommission} from '../core/station-admin';
import {commission,pricingForPartner,COMMISSION_TIERS_BPS,DEFAULT_PRICING} from '../core/pricing';
import {seedData} from '../core/seed';
import {validateData} from '../core/invariants';
const now=1800000000000;
/** 61 min = 400 centimes (au-dessus de l'heure entamée, sous le plafond) : un montant où chaque palier donne une commission distincte. */
const rent=(d:ReturnType<typeof seedData>,e:RentalEngine,customer:string,station='station-paris')=>{const r=e.start(d,customer,station,`key-${customer}`,now);e.return(d,r.id,station,now+61*60000);return r;};

test('pricingForPartner: seul un taux propre surcharge la grille',()=>{
 assert.equal(pricingForPartner(DEFAULT_PRICING,null).commissionBps,2000);
 assert.equal(pricingForPartner(DEFAULT_PRICING,undefined).commissionBps,2000);
 assert.equal(pricingForPartner(DEFAULT_PRICING,500).commissionBps,500);
 assert.equal(pricingForPartner(DEFAULT_PRICING,0).commissionBps,0,'0 % est un taux choisi, pas une absence de taux');
 assert.deepEqual({...pricingForPartner(DEFAULT_PRICING,500),commissionBps:2000},DEFAULT_PRICING,'seule la commission change');
});

test('un partenaire sans taux propre suit la grille tarifaire',()=>{
 const d=seedData('hash',now),e=new RentalEngine();
 assert.equal(d.partners.find(p=>p.id==='partner-a')?.commissionBps,null);
 const r=rent(d,e,'sans-taux');
 assert.equal(r.pricing.commissionBps,2000);assert.equal(r.amountCents,400);assert.equal(r.commissionCents,80);
 validateData(d);
});

test('chaque palier proposé produit la commission attendue, invariants compris',()=>{
 for(const bps of COMMISSION_TIERS_BPS){
  const d=seedData('hash',now),e=new RentalEngine();
  setPartnerCommission(d,'partner-a',bps);
  const r=rent(d,e,`palier-${bps}`);
  assert.equal(r.pricing.commissionBps,bps);
  assert.equal(r.amountCents,400);
  assert.equal(r.commissionCents,Math.floor(400*bps/10_000));
  assert.equal(r.commissionCents,commission(r.amountCents,r.pricing),'trigger Postgres batyeo_check_settlement : commissionCents doit dériver du snapshot');
  validateData(d);
 }
});

test('deux partenaires facturent chacun à leur propre taux sur le même jeu de données',()=>{
 const d=seedData('hash',now),e=new RentalEngine();
 d.stations.find(s=>s.id==='station-lille')!.online=true;
 setPartnerCommission(d,'partner-a',500);setPartnerCommission(d,'partner-b',3000);
 const a=rent(d,e,'chez-a','station-paris'),b=rent(d,e,'chez-b','station-lille');
 assert.equal(a.commissionCents,20);assert.equal(b.commissionCents,120);
 validateData(d);
});

test('changer le taux ne recalcule jamais une location déjà terminée',()=>{
 const d=seedData('hash',now),e=new RentalEngine();
 setPartnerCommission(d,'partner-a',500);
 const r=rent(d,e,'historique');
 assert.equal(r.commissionCents,20);
 setPartnerCommission(d,'partner-a',3000);
 assert.equal(r.commissionCents,20,'la location terminée garde la commission facturée');
 assert.equal(r.pricing.commissionBps,500,'et le taux figé dans son propre snapshot');
 validateData(d);
 const suivante=rent(d,e,'apres-changement');
 assert.equal(suivante.commissionCents,120,'seules les locations suivantes utilisent le nouveau taux');
 validateData(d);
});

test('le taux est figé à la création de la location, pas lu à la restitution',()=>{
 const d=seedData('hash',now),e=new RentalEngine();
 setPartnerCommission(d,'partner-a',500);
 const r=e.start(d,'en-cours','station-paris','en-cours',now);
 assert.equal(r.pricing.commissionBps,500);
 setPartnerCommission(d,'partner-a',3000);
 e.return(d,r.id,'station-paris',now+61*60000);
 assert.equal(r.commissionCents,20,'une location en cours conserve le taux accepté au départ');
 validateData(d);
});

test('repasser un partenaire sur la grille le fait suivre les changements de grille',()=>{
 const d=seedData('hash',now),e=new RentalEngine();
 setPartnerCommission(d,'partner-a',3000);
 assert.equal(rent(d,e,'avant').commissionCents,120);
 setPartnerCommission(d,'partner-a',null);
 assert.equal(rent(d,e,'grille').commissionCents,80);
 d.pricing[0].commissionBps=1000;
 assert.equal(rent(d,e,'grille-modifiee').commissionCents,40);
 validateData(d);
});

test('setPartnerCommission refuse un partenaire inconnu et un taux hors bornes',()=>{
 const d=seedData('hash',now);
 assert.throws(()=>setPartnerCommission(d,'partenaire-fantome',500),/Partenaire introuvable/);
 for(const bad of [-1,10_001,1.5,NaN])assert.throws(()=>setPartnerCommission(d,'partner-a',bad),/Taux de commission invalide/);
 assert.equal(d.partners.find(p=>p.id==='partner-a')?.commissionBps,null,'aucun refus ne laisse de trace');
 setPartnerCommission(d,'partner-a',10_000);
 assert.equal(d.partners.find(p=>p.id==='partner-a')?.commissionBps,10_000);
 validateData(d);
});
