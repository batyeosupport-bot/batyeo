# Staging go-live gate (read-only hardware)

Run, in order:

1. `pnpm staging:doctor`
2. `pnpm prisma migrate deploy` with the staging `DATABASE_URL`
3. `pnpm manufacturer:check` (read-only endpoints only)
4. capture an anonymised fixture if approved
5. map the real manufacturer device ID to exactly one BATYEO station
6. run one manual read-only sync and inspect reconciliation records
7. run `pnpm hardware:doctor`
8. enable the scheduler only after the manual run is healthy

For CI or deployment gates, run `pnpm release:readiness:json`. It emits only
evidence-based component statuses and never includes secrets. `BLOCKED` and
`NOT_VERIFIED` must remain visible until the corresponding external access is
actually available.

`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false` is mandatory. No hardware command, binding, firmware, ads, TPE or payment is enabled by this gate. A later physical test requires explicit staging, station allowlist, operator confirmation and a passing preflight.
