# Unknown physical result

Stop. Mark `UNKNOWN_RESULT` / `REQUIRES_RECONCILIATION`; never blind-retry. Query the provider read-only, compare slots/batteries, record the incident and resolve manually before a second command.

## Where this lives in the code (as of 2026-09-17)

A physical station provider that cannot confirm the outcome of a command it sent (e.g. a
network timeout after dispatch to the manufacturer) must throw `PhysicalResultUnknownError`
(`core/providers.ts`) instead of a plain `DomainError`. Both call sites that eject a battery —
`RentalEngine.start()` (`core/rental.ts`) and `StripeRentalCoordinator.start()`
(`core/stripe-coordinator.ts`) — catch that specific error type and call
`RentalEngine.markEjectionUncertain(d, rentalId, error, now)` instead of `failEjection`.

That call:
- Leaves the rental in `EJECTING` (never `ACTIVE`, never `EJECTION_FAILED`) and sets
  `physicalState: 'UNKNOWN'`.
- Leaves the Stripe/mock authorization exactly as it was (`AUTHORIZED`) — it is never
  captured or released on a guess.
- Is idempotent: re-reporting the same uncertainty (e.g. a retried webhook or job) is a no-op.
- Blocks any further automatic action: `beginEjection` on that rental now throws, because the
  rental is no longer in `PAYMENT_AUTH`. This is the "never blind-retry" guarantee, enforced by
  the state machine itself rather than by a separate lock.
- Surfaces as a `CRITICAL` `PHYSICAL_UNKNOWN` ops alert (`core/ops-alerts.ts`), shown in the
  admin monitoring panel, distinct from the `PAYMENT_MISMATCH` alert used for payment-only
  uncertainty.

**Manual resolution**, once a human has confirmed reality against a read-only provider query:
- Battery actually left the slot → `RentalEngine.activateWithBattery(d, rentalId, batteryId, now)`.
  The rental becomes `ACTIVE` and billing starts from that moment, exactly like the normal path.
- Battery never left the slot → `RentalEngine.failEjection(d, rentalId, error, now)` followed by
  `markPaymentReleased`, exactly like a confirmed ejection failure today.

**What is still missing, deliberately:** no code calls the manufacturer's ejection endpoint at
all. `/rent/cabinet/query` and `/rent/cabinet/list` are the only Bajie Open API routes the
manufacturer has confirmed, and both are read-only — whether an ejection command endpoint even
exists has not been confirmed by ChargeNow. Do not invent that path. When it is confirmed, the
real manufacturer `BatteryStationProvider` implementation is the one place that should decide,
after a bounded wait, whether to return a battery ID, throw a plain `DomainError` (confirmed
failure), or throw `PhysicalResultUnknownError` (timeout/no confirmation) — the reconciliation
machinery described above already handles all three outcomes correctly and is fully tested
(`tests/physical-reconciliation.test.ts`) without needing manufacturer credentials.
