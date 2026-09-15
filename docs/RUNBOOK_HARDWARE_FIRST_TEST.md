# Future first hardware test (blocked by design)

- One staging station and one battery only.
- Operator physically present; logs and correlation IDs open.
- `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` must be explicitly reviewed and is currently false.
- One unique command ID; no automatic loop and no blind retry.
- Verify provider result with a read-only query before changing trusted BATYEO state.
- On timeout or unknown result: stop immediately, mark `UNKNOWN_RESULT` / `REQUIRES_RECONCILIATION`, and investigate manually.

Before connecting hardware, run:

1. `pnpm staging:bootstrap`
2. `pnpm hardware:acceptance`
3. `pnpm release:readiness:json`

The expected pre-hardware result is `PARTIALLY_READY`; runtime, provider and
physical capabilities must remain `NOT_VERIFIED` until observed on the actual
station. Use `pnpm staging:golden-flow` and `pnpm staging:failure-matrix` for
the non-destructive rehearsal.
