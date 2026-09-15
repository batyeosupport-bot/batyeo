# Stripe TEST

Use only `PAYMENT_PROVIDER=stripe_test` and test credentials from a secret manager. Manual capture authorizes the configured deposit, captures the server-calculated amount after a confirmed return, and releases the remainder. Webhook signatures and idempotency are mandatory. Stripe Live is rejected by configuration guards.
