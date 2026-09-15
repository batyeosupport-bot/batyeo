# Station runtime installation readiness

Supported deployment targets are intentionally equivalent contracts: a managed WebView/browser kiosk, PWA kiosk, Android APK, or manufacturer-hosted WebView. Select the target only after hardware discovery records the OS, WebView, kiosk and update capabilities.

Boot sequence: load last-known-good config → authenticate runtime → fetch signed/versioned config → heartbeat → check Core/provider health → READY, DEGRADED, OFFLINE or MAINTENANCE.

Offline mode renders the last valid config but cannot start a server-backed rental and must never display a false READY state. Updates require a minimum-supported check, checksum validation, staged rollout and rollback to last-known-good. No binary installation is performed by this repository.
