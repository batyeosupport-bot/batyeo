# BATYEO staging

1. Inject secrets only through the staging secret manager: `DATABASE_URL`, `MANUFACTURER_PROVIDER=bajie`, API URL, username/password, `MANUFACTURER_SYNC_SECRET`.
2. Confirm `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false`.
3. Run `pnpm prisma migrate deploy` and inspect the migration result without printing `DATABASE_URL`.
4. Run `MANUFACTURER_CHECK_DEVICE_ID=… pnpm manufacturer:check`.
5. Capture fixtures only with the explicit anonymization flag.
6. Associate one documented device, run one manual sync, inspect health and reconciliation records, then enable the scheduler.

For a local preflight without external services, run `pnpm staging:bootstrap`.
It executes the doctors plus the mock golden flow and failure matrix. For CI,
use `pnpm release:readiness:strict`; it fails closed while PostgreSQL, Bajie,
or store credentials are not verified.

Stop on any unknown physical result. Do not use D1 to certify staging PostgreSQL.
