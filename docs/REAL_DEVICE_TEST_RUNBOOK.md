# Real-device validation checklist

Record PASS/FAIL/NOT_VERIFIED for each item; do not infer results from simulator tests.

- Install staging build on iOS and Android
- Scan a valid and invalid station QR
- Open `batyeo://` deep link and HTTPS fallback
- Claim a web handoff, kill/relaunch the app, recover the same rental
- Verify camera and optional location permissions
- Exercise slow network, offline and reconnect states
- Start mock payment, active rental, return and receipt/history
- Create a support ticket linked to the rental
- Verify notification permission and no-op behavior without credentials
- Confirm no secrets or payment data are present in device storage/logs

Physical ejection, Stripe Live and store publication are separate, explicitly authorized phases.
