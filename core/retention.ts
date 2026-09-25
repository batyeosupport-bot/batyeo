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
/**
 * UNTRUSTED is purged alongside PROCESSED: the manufacturer webhook is public and unsigned, so
 * anyone can create those rows and nothing ever promotes them — left in place they grew without
 * bound. RECEIVED and FAILED only exist behind a verified Stripe signature and stay for diagnosis.
 */
const PURGEABLE:ReadonlySet<string>=new Set(['PROCESSED','UNTRUSTED']);
export function purgeSettledWebhookEvents(d:Data,now=Date.now()):number{
 const cutoff=now-WEBHOOK_RETENTION_MS,before=d.webhookEvents.length;
 d.webhookEvents=d.webhookEvents.filter(e=>!PURGEABLE.has(e.status)||e.receivedAt>cutoff);
 return before-d.webhookEvents.length;
}

/**
 * Rows that only ever matter until they expire. Customer sessions are the big one: every first
 * visit to a rental page creates one, bots included, and none was ever removed. Sync runs pile up at
 * up to one every two minutes while the site is visited; health and throttling only read the recent
 * ones, so two weeks is plenty. A rental points at a customer id, never at a session, so nothing
 * of value goes with them.
 */
export const SYNC_RUN_RETENTION_MS=14*24*60*60*1000;
export function purgeExpiredRecords(d:Data,now=Date.now()):number{
 const before=d.sessions.length+d.customerSessions.length+d.limits.length+d.customerHandoffTokens.length+d.manufacturerSyncRuns.length;
 d.sessions=d.sessions.filter(s=>s.expiresAt>now);
 d.customerSessions=d.customerSessions.filter(s=>s.expiresAt>now);
 d.limits=d.limits.filter(l=>l.expiresAt>now);
 d.customerHandoffTokens=d.customerHandoffTokens.filter(t=>t.expiresAt>now);
 d.manufacturerSyncRuns=d.manufacturerSyncRuns.filter(r=>r.status==='RUNNING'||r.startedAt>now-SYNC_RUN_RETENTION_MS);
 return before-(d.sessions.length+d.customerSessions.length+d.limits.length+d.customerHandoffTokens.length+d.manufacturerSyncRuns.length);
}
