# Payment failure

Keep the rental out of ACTIVE unless authorization is confirmed by Core. On post-authorization ejection failure, release/cancel the authorization through the configured provider and reconcile. Never trust a client callback or capture an unconfirmed amount.
