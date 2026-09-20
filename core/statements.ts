import type {Actor,Data} from './types';
import {inTenant} from './rental';

export interface PartnerStatement {partnerId:string;partnerName:string;from:number;to:number;rentals:number;grossCents:number;refundedCents:number;netCents:number;commissionCents:number;}

/**
 * What a partner is actually owed for a period. Commission was computed and displayed per rental
 * but nothing ever added it up into something payable, so no partner could be paid without doing
 * the arithmetic by hand. Counted on the return date, not the start date: a rental that straddles
 * the boundary belongs to the period it was settled in, which is the one being paid out.
 * Refunds reduce the takings but never the commission — the partner's share is frozen in each
 * rental's pricing snapshot, and the settlement invariant depends on it staying that way.
 */
export function partnerStatements(d:Data,actor:Actor,from:number,to:number):PartnerStatement[]{
 return d.partners.filter(p=>inTenant(actor,p.id)).map(partner=>{
  const rentals=d.rentals.filter(r=>r.partnerId===partner.id&&r.returnedAt!==null&&r.returnedAt>=from&&r.returnedAt<to&&['COMPLETED','LOST','RETURNED'].includes(r.state));
  const totals=rentals.reduce((sum,r)=>{
   const payment=d.payments.find(p=>p.rentalId===r.id);
   return {gross:sum.gross+(payment?.capturedCents??0),refunded:sum.refunded+(payment?.refundedCents??0),commission:sum.commission+r.commissionCents};
  },{gross:0,refunded:0,commission:0});
  return {partnerId:partner.id,partnerName:partner.name,from,to,rentals:rentals.length,grossCents:totals.gross,refundedCents:totals.refunded,netCents:totals.gross-totals.refunded,commissionCents:totals.commission};
 }).sort((a,b)=>b.commissionCents-a.commissionCents);
}

/** Exported so an operator can hand the figures to their accountant or their bank as-is. */
export function statementsCsv(rows:PartnerStatement[]):string{
 const euros=(cents:number)=>(cents/100).toFixed(2).replace('.',',');
 const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
 const head='Partenaire;Du;Au;Locations;Encaisse;Rembourse;Net;Commission a verser';
 // Semicolons and comma decimals: what a French spreadsheet opens without an import wizard.
 return [head,...rows.map(r=>[r.partnerName.replaceAll(';',','),day(r.from),day(r.to-1),r.rentals,euros(r.grossCents),euros(r.refundedCents),euros(r.netCents),euros(r.commissionCents)].join(';'))].join('\n');
}
