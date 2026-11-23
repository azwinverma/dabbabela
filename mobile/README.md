# Dabba Bela — mobile app (Flutter)

One role-aware app (`com.dabbabela.app`, "Dabba Bela") for **customers, riders, kitchen staff and dispatchers**, on the
`/api/v1` REST API ([`docs/api/README.md`](../docs/api/README.md), [`openapi.yaml`](../docs/api/openapi.yaml)).
Super admin, finance and CMS stay on the website.

Toolchain: Flutter **3.29.3** / Dart **3.7.2**. Dependencies are pinned to exact versions in `pubspec.yaml`.

## Run

```sh
cd mobile
flutter pub get                 # also generates lib/l10n/gen (flutter gen-l10n)
flutter run                     # production API: https://dabbabela.vercel.app/api/v1

# another backend (debug builds may use http; release builds refuse anything but https)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1      # Android emulator → local Next.js
flutter run --dart-define=API_BASE_URL=https://staging.example.com/api/v1
```

iOS simulators block plain http by default (App Transport Security). Use an https backend (e.g. a Vercel preview) or
add a local-only ATS exception in Xcode — never commit it.

Checks (all must stay green):

```sh
flutter analyze                 # flutter_lints + strict casts/raw types; 0 issues
flutter test                    # 55 tests: API client, models, widgets
```

## Architecture

| Layer | Where | Notes |
|---|---|---|
| Config | `lib/core/config.dart` | `API_BASE_URL` dart-define (default production), https enforced in release, `User-Agent: DabbaBela/<version> (<ios\|android>)` |
| HTTP | `lib/core/api/api_client.dart` | dio. Bearer token interceptor, success envelope `{data, meta?}` → `ApiResponse`, error envelope → typed `ApiException` (`api_exception.dart`; network / timeout / server, user-safe message, `fields`), `401 UNAUTHENTICATED` → session drops the token and shows sign-in |
| Idempotency | `lib/core/api/idempotency.dart` | Money-moving POSTs pass `idempotent: true`. Key = per user action (fingerprint of method + path + body), reused for automatic retries (network, timeout, `409 IDEMPOTENCY_IN_PROGRESS`, 5xx), for a second tap and across app restarts (persisted 24 h in secure storage), released on a definitive answer |
| Token | `lib/core/storage/secure_store.dart` | Keychain / Android Keystore (`flutter_secure_storage`) only; never logged |
| State | Riverpod 2 (no codegen) | `lib/core/providers.dart` (API, settings, locale), `features/*/…_providers` |
| Session | `lib/features/auth/session.dart` | sign-in → 2FA challenge → token → `GET /me` → route by `apps`; staff TOTP enrolment replaces the token; sign-out unregisters the push token |
| Routing | `lib/router.dart` (go_router) | `sessionRedirect` guard (unit-tested): signed-out → `/auth/*`; one app → its home; several → `/switch`; sections not in `apps` are refused. Customer = 5-tab shell (`/c/*`); `/rider`, `/kitchen`, `/dispatch` |
| Models | `lib/models/*.dart` | Hand-written, tolerant readers (`lib/core/json.dart`): unknown fields ignored, missing ones defaulted (the API is additive-only) |
| Money / dates | `lib/core/format/` | Integer paisa → "Rs 1,250" / "रु 1,250" (Indian grouping, same as `src/lib/money.ts`); service dates `YYYY-MM-DD` in Asia/Kathmandu (fixed UTC+05:45) |
| UI kit | `lib/core/widgets/`, `lib/core/theme/` | Brand tokens from `tailwind.config.ts` (sindoor, saag, haldi, ink, paper…), light + dark themes, Plus Jakarta Sans / DM Sans / Noto Sans Devanagari bundled (`assets/fonts`, static instances of the site's fonts), 48 dp controls, loading / empty / error (offline-aware) states, pull-to-refresh, cursor-paginated lists |
| i18n | `l10n_parts/*.json` → `lib/l10n/app_{en,ne}.arb` | English and Nepali side by side per string. After editing: `python3 tool/build_arb.py && flutter gen-l10n`. Nepali needs a native-speaker review before launch |
| Push | `lib/core/push/push_service.dart` | `PushService` interface, `NoopPushService` default — see "Push" below |

### Features

* **Auth**: email/password, 2FA code (TOTP or backup), sign-up (company + referral code), forgot password (+ "I have a
  reset code"), phone OTP when `settings.flags.phoneOtp`, staff TOTP enrolment (QR from `totpURI`, setup key, backup
  codes, confirm → new token), signed-in devices (revoke one / all others), language, sign-out. Staff with
  `twoFactor.setupRequired` see a banner; staff sections stay hidden until enrolled (server rule).
* **Customer**: home (today / upcoming meals, hand-off code while out for delivery, plan progress), weekly menu by date
  (company menu respected), dabba detail (contents, allergens with your allergy hits, nutrition, swaps, orderable
  dates), cart → server quote (`/cart/quote`) → checkout (address, slot from coverage, method incl. wallet, coupon,
  notes) → order (idempotent) → payment: eSewa (auto-submitted form in a webview) / Khalti (URL in a webview), closed
  on `returnUrlPrefixes`, then **polls** `GET /payments/{id}`; bank transfer with details/QR + proof upload
  (image_picker); switch method. Orders (upcoming/past, detail, timeline, cancel, skip/unskip, swap incl.
  pay-the-difference, pay, rate, get help). Plans: browse, subscribe (start date, days, weeks, veg-only, address, slot,
  method, coupon, live quote), my plan (meals, pause/resume/cancel, renew with quote, add a meal, change address,
  pending swap payments). Addresses CRUD with coverage check, wallet balance + ledger + top-up (only when the flags say
  so), payments history, notifications, refer a friend (share link), support tickets, profile, food and notification
  preferences, privacy export (share JSON) / deletion request.
* **Rider**: day picker within the server window, routes, ordered stops (call / navigate via the maps app using the
  address text), deliver (4-digit code when required, cash due prefilled, photo when required, note — idempotent),
  fail with a reason, finish route. The hand-off code is **never** shown to riders.
* **Kitchen**: kitchen picker (scope), production for a date (counts, by dabba / slot, dishes, orders), bulk start
  preparing / pack (four packing checks), batches (plan, cook, done with portions), QC log, stock alerts (read-only).
* **Dispatcher**: board (slot × zone, unrouted orders), create route / add orders, assign or change rider, start,
  complete, remove a stop, auto-group, failed deliveries → retry or cancel with credit (idempotent).

### Security

Token only in secure storage; no logging of tokens, bodies or PII; release builds are https-only
(`usesCleartextTraffic=false`, ATS default; the debug manifest alone allows http for a local backend); Android
`allowBackup=false`. Certificate pinning and idle re-auth are intentionally not implemented; screenshots allowed.

## Push (TODO — no Firebase project yet)

1. Create a Firebase project; add Android app `com.dabbabela.app` and iOS app `com.dabbabela.app`.
2. Put `google-services.json` in `android/app/` and `GoogleService-Info.plist` in `ios/Runner/`.
3. Add `firebase_core` + `firebase_messaging`; apply `com.google.gms.google-services` in Gradle; in Xcode enable Push
   Notifications + Background Modes → Remote notifications; upload an APNs auth key to Firebase.
4. Implement `PushService` with FirebaseMessaging and return it from `pushServiceProvider`.
5. Server side: sending (FCM HTTP v1) is not built yet — tokens are already stored via `POST /devices`.

## Release (owner steps)

Bump `version:` in `pubspec.yaml` (and `APP_VERSION`, used in the User-Agent: `--dart-define=APP_VERSION=1.0.1`) for
every upload. Generate icons first: `dart run flutter_launcher_icons` (uses `assets/brand/app-icon.png`).

### Android (Google Play)

1. Create an upload key (keep it and its passwords safe, outside the repo):
   `keytool -genkey -v -keystore ~/dabbabela-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
2. Create `mobile/android/key.properties` (gitignored):
   ```
   storePassword=…
   keyPassword=…
   keyAlias=upload
   storeFile=/Users/<you>/dabbabela-upload.jks
   ```
3. `flutter build appbundle --release` → `build/app/outputs/bundle/release/app-release.aab`.
4. Play Console: create the app, enrol in Play App Signing, fill store listing (EN + NE), content rating, data-safety
   form (account info, phone, address, purchase history, photos you upload; data encrypted in transit; deletion
   request in-app), privacy policy URL (the website's), target audience; upload to internal testing first.

### iOS (App Store)

1. Apple Developer account (organisation, needs a D-U-N-S number) → App ID `com.dabbabela.app`.
2. `cd ios && pod install` (first time), open `Runner.xcworkspace`, set the Team, signing "Automatic", deployment
   target iOS 13.
3. `flutter build ipa --release`, upload with Xcode Organizer or Transporter.
4. App Store Connect: app record, screenshots (6.7" and 5.5"), privacy nutrition labels, export compliance (the app
   sets `ITSAppUsesNonExemptEncryption=false` — standard HTTPS only), review notes with a **demo customer account and
   a demo rider account** (staff accounts need 2FA — give the reviewer a TOTP secret or a non-staff demo), then
   TestFlight → submit.

## Not verified yet

Built and tested with unit + widget tests and a web compile; **not yet run on a real Android or iOS device**, no
Android/iOS release build (disk space), payment gateways not exercised end-to-end in the webview (sandbox merchant
keys needed), push not wired.
