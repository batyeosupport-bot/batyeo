import {DomainError} from './providers';
export type PaymentMode='mock'|'stripe_test';
/** Configuration guard: Stripe Live can never be selected by this build. */
export function resolvePaymentMode(env:Record<string,string|undefined>):PaymentMode{const requested=env.PAYMENT_PROVIDER??env.BATYEO_PAYMENT_PROVIDER??'mock';if(requested==='mock')return 'mock';if(requested!=='stripe_test')throw new DomainError('Provider de paiement non autorisé.',503);if(!env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new DomainError('Stripe TEST nécessite STRIPE_SECRET_KEY.',503);return 'stripe_test';}
