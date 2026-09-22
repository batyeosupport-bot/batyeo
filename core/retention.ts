import type {Data} from './types';
/**
 * Every request loads the whole snapshot, so a table nobody prunes slows the entire product down
 * as it grows. The webhook ledger is by far the fastest-growing one — one row, payload included,
 * per Stripe event and per battery movement — and the only one with no lasting value: the Payment
 * rows hold the financial truth, and the ledger exists purely to recognise a delivery already seen.
 * Stripe stops retrying after about three days, so a month is a wide margin.
 * Audit logs and rental timelines are deliberately left alone: they are accounting and dispute
 * evidence, and dropping them is not a performance decision to make here.
 */
export const WEBHOOK_RETENTION_MS=30*24*60*60*1000;
export function purgeSettledWebhookEvents(d:Data,now=Date.now()):number{
 const cutoff=now-WEBHOOK_RETENTION_MS,before=d.webhookEvents.length;
 d.webhookEvents=d.webhookEvents.filter(e=>e.status!=='PROCESSED'||e.receivedAt>cutoff);
 return before-d.webhookEvents.length;
}
