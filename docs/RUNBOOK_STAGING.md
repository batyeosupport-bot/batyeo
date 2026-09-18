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

## Migration en attente sur staging au 2026-09-19

`202609190002_partner_commission_override` (surcharge de commission par partenaire) n'est
pas appliquée. Le code déployé le tolère : `Partner.commissionBps` y vaut encore 2000
partout, donc la commission reste à 20 % comme avant, et les paliers 0/5/10/20/30 %
s'enregistrent normalement.

Seul symptôme : choisir « Taux de la grille » dans l'admin écrit `NULL` dans une colonne
encore `NOT NULL`, et l'erreur remonte en **503 « Le service est temporairement
indisponible »** — le message générique, pas une panne réelle. Vérifié en direct : la
transaction est annulée proprement, aucune donnée n'est touchée et le reste du site
continue de répondre.

Pour lever ça : `pnpm prisma migrate deploy` avec le `DATABASE_URL` de staging (projet
`mrmbhdachgrzzjtylzwv`, jamais celui de `.env`, qui pointe la production).
