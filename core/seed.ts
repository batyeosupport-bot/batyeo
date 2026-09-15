import {emptyData,type Data} from './types';
import {DEFAULT_PRICING} from './pricing';
import {RentalEngine} from './rental';
export function seedData(passwordHash:string,now=Date.now()):Data {
 const d=emptyData();d.pricing=[{...DEFAULT_PRICING}];
 d.partners=[{id:'partner-a',name:'BATYEO Demo Hospitality',city:'Paris · Lyon',commissionBps:2000},{id:'partner-b',name:'BATYEO Demo Nightlife',city:'Lille',commissionBps:2000}];
 d.venues=[{id:'venue-paris',partnerId:'partner-a',name:'Hôtel Démo Paris',city:'Paris',address:'Adresse fictive · Paris 02',category:'Hôtel',hours:'24 h / 24'},{id:'venue-lyon',partnerId:'partner-a',name:'Restaurant Démo Lyon',city:'Lyon',address:'Adresse fictive · Lyon 02',category:'Restaurant',hours:'12:00 – 23:00'},{id:'venue-lille',partnerId:'partner-b',name:'Club Démo Lille',city:'Lille',address:'Adresse fictive · Lille Centre',category:'Club',hours:'20:00 – 05:00'}];
 d.stations=[{id:'station-paris',publicId:'paris-demo',venueId:'venue-paris',partnerId:'partner-a',online:true,failure:'none',capacity:8},{id:'station-lyon',publicId:'lyon-demo',venueId:'venue-lyon',partnerId:'partner-a',online:true,failure:'none',capacity:6},{id:'station-lille',publicId:'lille-demo',venueId:'venue-lille',partnerId:'partner-b',online:false,failure:'none',capacity:8}];
 for(const s of d.stations)for(let i=1;i<=s.capacity;i++){const id=`BAT-${s.publicId.slice(0,3).toUpperCase()}-${String(i).padStart(3,'0')}`;const occupied=i<=s.capacity-2;d.slots.push({id:`${s.id}-${i}`,stationId:s.id,position:i,batteryId:occupied?id:null});if(occupied)d.batteries.push({id,charge:95-i*3,status:'AVAILABLE'});}
 d.users=[{id:'admin-demo',email:'admin@batyeo.demo',name:'Camille · Démo',role:'SUPER_ADMIN',partnerId:null,passwordHash},{id:'partner-demo',email:'partner@batyeo.demo',name:'Alex · Démo',role:'PARTNER_ADMIN',partnerId:'partner-a',passwordHash},{id:'partner-b-demo',email:'partner-b@batyeo.demo',name:'Sam · Démo',role:'PARTNER_ADMIN',partnerId:'partner-b',passwordHash},...(['OPERATIONS','FINANCE','SUPPORT','ADMIN','PARTNER_USER'] as const).map(role=>({id:role.toLowerCase(),email:role==='ADMIN'?'team-admin@batyeo.demo':`${role.toLowerCase()}@batyeo.demo`,name:`${role} · Démo`,role,partnerId:role==='PARTNER_USER'?'partner-a':null,passwordHash}))];
 d.partnerUsers=d.users.filter(u=>u.partnerId).map(u=>({id:`membership-${u.id}`,userId:u.id,partnerId:u.partnerId!}));
 const engine=new RentalEngine();
 for(let i=0;i<18;i++){const start=now-(i*110+90)*60_000;const s=d.stations[i%2];const r=engine.start(d,`seed-customer-${i}`,s.id,`seed-${i}`,start);engine.return(d,r.id,s.id,start+(i%5*60+28)*60_000);}
 engine.start(d,'seed-active-1','station-paris','seed-active-1',now-75*60_000);
 engine.start(d,'seed-active-2','station-lyon','seed-active-2',now-25*60_000);
 engine.start(d,'seed-overdue','station-paris','seed-overdue',now-49*3_600_000);engine.refreshOverdue(d,now);
 d.stations[1].failure='ejection';engine.start(d,'seed-failure','station-lyon','seed-failure',now-40*60_000);d.stations[1].failure='none';
 d.tickets=[{id:'ticket-demo-1',partnerId:'partner-a',email:'partner@batyeo.demo',subject:'Vérifier la signalétique QR',message:'Demande de démonstration : vérifier que le QR code est visible à la réception.',status:'OPEN',createdAt:now-2*3_600_000}];
 return d;
}
