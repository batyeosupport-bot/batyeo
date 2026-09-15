# Bajie / ChargeNow read-only runbook

Only `GET /rent/cabinet/query` and documented `POST /rent/cabinet/list` are used. Authentication stays per endpoint documentation; Basic on these routes does not imply Basic elsewhere. `vol`, `freeNum`, `busySlots` and `infoStatus` remain provider telemetry with no invented business meaning.

The read-only check reports status, provider code, latency and safe structure only. A `2002 / QR code unbound device.` response is preserved verbatim and has no additional BATYEO interpretation.
