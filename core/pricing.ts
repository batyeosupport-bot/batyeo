export type PricingStrategy = { id: string; hourlyCents: number; capCents: number; depositCents: number; deadlineHours: number; commissionBps: number };
export const DEFAULT_PRICING: PricingStrategy = { id: 'standard-v1', hourlyCents: 200, capCents: 800, depositCents: 2000, deadlineHours: 48, commissionBps: 2000 };
export function calculatePrice(elapsedMs: number, p: PricingStrategy = DEFAULT_PRICING): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid duration');
  return Math.min(Math.max(1, Math.ceil(elapsedMs / 3_600_000)) * p.hourlyCents, p.capCents);
}
export const commission = (cents: number, p: PricingStrategy) => Math.floor(cents * p.commissionBps / 10_000);
/** Paliers de commission proposés dans l’admin. Un partenaire sans taux propre suit celui de la grille active. */
export const COMMISSION_TIERS_BPS = [0, 500, 1000, 2000, 3000] as const;
/**
 * Le taux d’un partenaire surcharge celui de la grille, mais uniquement dans le snapshot figé
 * sur la location : commissionCents doit toujours valoir amountCents × pricingSnapshot.commissionBps
 * (invariant TS « completed commission » ET trigger Postgres batyeo_check_settlement). Porter le
 * taux dans le snapshot est donc la seule façon de le rendre variable par partenaire, et c’est
 * aussi ce qui garantit qu’un changement de taux ne recalcule jamais une location déjà terminée.
 */
export const pricingForPartner = (p: PricingStrategy, partnerCommissionBps: number|null|undefined): PricingStrategy =>
  partnerCommissionBps == null ? p : { ...p, commissionBps: partnerCommissionBps };
export const euro = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
