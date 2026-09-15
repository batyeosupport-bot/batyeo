# Station runtime enrollment

1. In staging, an Admin issues a one-time token scoped to one BATYEO station (10 minute TTL).
2. The runtime presents the token once; Core binds `runtimeId` to the station and returns a credential only once.
3. Store only the credential in the runtime's secure OS storage. Never put it in logs or browser storage.
4. Revoke immediately when a device is lost; rotate after recovery. A used, expired, or cross-tenant token is rejected.
5. Verify the first heartbeat and remote config before marking the runtime READY.

Physical actions remain disabled. Enrollment never calls a manufacturer write API.
