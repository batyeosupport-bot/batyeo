export type PricingStrategy = { id: string; hourlyCents: number; capCents: number; depositCents: number; deadlineHours: number; commissionBps: number };
export const DEFAULT_PRICING: PricingStrategy = { id: 'standard-v1', hourlyCents: 200, capCents: 800, depositCents: 2000, deadlineHours: 48, commissionBps: 2000 };
export function calculatePrice(elapsedMs: number, p: PricingStrategy = DEFAULT_PRICING): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid duration');
  return Math.min(Math.max(1, Math.ceil(elapsedMs / 3_600_000)) * p.hourlyCents, p.capCents);
}
export const commission = (cents: number, p: PricingStrategy) => Math.floor(cents * p.commissionBps / 10_000);
export const euro = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
