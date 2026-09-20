import {DomainError} from './providers';
export type PaymentMode='mock'|'stripe_test'|'stripe_live';
/** True only when the money is real. Everything the customer is told about their payment — the
 * banner, the security note, the receipt wording — is derived from this rather than hardcoded, so
 * the day the switch flips the product stops calling itself a demonstration by itself. */
export const isRealMoney=(mode:PaymentMode)=>mode==='stripe_live';
/**
 * Live mode exists but is never the default and cannot be reached by accident: it demands the
 * explicit `stripe_live` value *and* a matching `sk_live_` key, so a test key left behind in the
 * environment fails loudly at startup instead of silently charging no one — or worse, the reverse.
 */
export function resolvePaymentMode(env:Record<string,string|undefined>):PaymentMode{
 const requested=env.PAYMENT_PROVIDER??env.BATYEO_PAYMENT_PROVIDER??'mock';
 if(requested==='mock')return 'mock';
 if(requested==='stripe_test'){if(!env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new DomainError('Stripe TEST nécessite une clé STRIPE_SECRET_KEY commençant par sk_test_.',503);return 'stripe_test';}
 if(requested==='stripe_live'){if(!env.STRIPE_SECRET_KEY?.startsWith('sk_live_'))throw new DomainError('Stripe LIVE nécessite une clé STRIPE_SECRET_KEY commençant par sk_live_.',503);return 'stripe_live';}
 throw new DomainError('Provider de paiement non autorisé.',503);
}
