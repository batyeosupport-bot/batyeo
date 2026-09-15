import {DomainError} from './providers';
import type {PaymentState} from './types';

const edges:Record<PaymentState, readonly PaymentState[]>={
 PENDING:['AUTHORIZING','AUTHORIZED','FAILED','UNKNOWN'],
 AUTHORIZING:['AUTHORIZED','FAILED','UNKNOWN'],
 AUTHORIZED:['CAPTURING','RELEASING','RELEASED','UNKNOWN'],
 CAPTURING:['CAPTURED','FAILED','UNKNOWN'],
 CAPTURED:[],
 RELEASING:['RELEASED','FAILED','UNKNOWN'],
 RELEASED:[],
 FAILED:['AUTHORIZING','UNKNOWN'],
 UNKNOWN:['AUTHORIZING','CAPTURING','RELEASING','AUTHORIZED','FAILED']
};
export function transitionPayment(from:PaymentState,to:PaymentState):PaymentState {
 if(from===to)return from;
 if(!edges[from].includes(to))throw new DomainError(`Transition paiement interdite : ${from} → ${to}`);
 return to;
}
export function canSettlePayment(state:PaymentState){return state==='AUTHORIZED'||state==='CAPTURING';}
