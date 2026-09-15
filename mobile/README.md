# BATYEO mobile V1

## Browser preview

When Expo dependencies are unavailable, open `mobile/preview.html` directly for a faithful, non-production DEMO walkthrough of the existing mobile flow. It uses no camera, GPS, payment, manufacturer or database access.

Install with `npm install`, copy `.env.example` to `.env`, then use `npm run web` for Expo Web or `npm start` for a native development client. The API URL must be reachable by the phone; `localhost` points to the phone itself. Native camera, SecureStore, GPS, notifications and OS deep-link behavior still require a simulator or device.

The app includes Home, QR scan with manual fallback, live station availability, pricing and terms, rental start, active rental recovery, return station selection, simulated demo return, receipt, history, support linked to a rental, and profile/settings. `EXPO_PUBLIC_BATYEO_DEMO=true` only exposes demo controls when the Core also declares demo mode, and startup rejects that flag when `EXPO_PUBLIC_BATYEO_ENV=production`.

## iPhone / TestFlight

From the `mobile` directory, install EAS CLI, run `eas login`, then `eas build --platform ios --profile preview`. EAS will create/sign the iOS build and provide an install link. For TestFlight use `eas build --platform ios --profile production`, then `eas submit --platform ios --profile production`; the build appears in App Store Connect/TestFlight after Apple processing. Replace the placeholder `ascAppId` and confirm the bundle id `com.batyeo.mobile` in App Store Connect. Never commit Apple credentials or API keys.

The mobile client is intentionally kept as a thin client of BATYEO Core. It
must never reimplement pricing, rental transitions, payment settlement or
station rules.

## Shared flow

1. Scan a station QR code and validate the public station id against `GET /api/core/public`.
2. Create or recover a customer session with `POST /api/core/customer/session`.
3. Start the rental through the Core with an idempotency key; the server owns terms,
   pricing, payment authorization and ejection state.
4. Call `POST /api/core/customer/handoff` to create a short-lived customer handoff token.
4. Open the app through a deep link and exchange the token with
   `POST /api/core/customer/claim` for the same
   customer session.
5. Read the active rental from `GET /api/core/customer`.
6. Return through the Core; the app only submits the target station and an
   idempotency key.

The contract in `contracts/customer-api.ts` is shared by web and mobile.
`CustomerRentalSnapshot` is a projection, never a source of financial truth.

## Planned deep links

```text
batyeo://rental/{rentalId}?handoff={short-lived-token}
https://batyeo-web.anismeslin5.chatgpt.site/rental/{rentalId}
```

The HTTPS link remains the fallback when the app is not installed. Native POSTs carry
`x-batyeo-client: mobile`; browser origins remain protected by the same-origin guard.

## Stations and notifications

`mobile/stations.ts` reads the same `GET /api/core/public` projection as the
web and falls back to a sorted list when a map provider is unavailable. Only
online stations with a free return slot are offered for restitution.

`mobile/notifications.ts` defines the notification adapter and schedule plan.
The default adapter is a no-op: no push or local notification is sent until
Expo notification credentials and permission are configured.

## Store readiness

- `com.batyeo.mobile` is a placeholder bundle/package id and must be replaced for production.
- Camera permission and the optional location permission are declared in `app.json`.
- `batyeo://` is the current development scheme; configure iOS Universal Links and
  Android App Links against the HTTPS domain before release.
- Set `EXPO_PUBLIC_BATYEO_CORE_URL` to the production API origin at build time.
- Replace the current BATYEO icon/splash assets only when final production artwork is approved; add privacy manifest, support URL and store metadata.
- Expo push credentials, Apple signing, Google keystore and store accounts are external
  prerequisites. No credentials are committed or required for the mock build.
