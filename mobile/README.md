# HireOrbit AI — mobile app

React Native + Expo. **A second client of the existing Express API** — there is no
separate mobile backend, no duplicated business logic, and no second database.

```
   Web (React)  ──┐
                  ├──▶  backend/  (unchanged)  ──▶ Postgres / uploads / Brevo / AI
   Mobile (Expo) ─┘
```

## Why React Native

Because `@hireorbitai/shared` can be imported directly. `canAssignRole`,
`roleRank`, `OPERATOR_TIER`, `hasCapability` and the task enums are the **same
compiled code** the backend and web frontend run. With Flutter those ~150 lines
of authorization logic would have been hand-reimplemented in Dart and kept in
sync by discipline alone — exactly the drift the shared package exists to
prevent.

## Setup

```bash
# from the repo root — mobile is an npm workspace
npm install
npm run shared:build          # mobile consumes shared/dist, not shared/src

cp mobile/.env.example mobile/.env
#   EXPO_PUBLIC_API_URL must be your machine's LAN IP for local dev.
#   A phone or emulator resolves `localhost` to ITSELF, not to your laptop.

npm run mobile:start          # then press i / a, or scan the QR
npm run mobile:typecheck
```

Running through **Expo Go** needs nothing else. The Expo Go app on the store
tracks the latest SDK, so `expo` here must match it — a mismatch is refused
outright with "Project is incompatible with this version of Expo Go".

## Building an APK — read this first

Two host requirements that are easy to miss, because neither is enforced until
a build is already several minutes in.

### JDK 17 is required, and JDK 21 will not substitute

`@react-native/gradle-plugin` declares `jvmToolchain(17)`. If no JDK 17 is
installed, Gradle tries to **auto-download** one through the `foojay-resolver`
plugin — and the version React Native pins (1.0.0) references
`JvmVendorSpec.IBM_SEMERU`, a field Gradle 9.3 removed. The build dies with:

```
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
```

That message names neither the JDK nor the toolchain, so it reads like a Gradle
bug. It isn't — it is "no JDK 17 present". Install one:

```bash
winget install EclipseAdoptium.Temurin.17.JDK      # Windows
brew install --cask temurin@17                     # macOS
```

Do **not** try to fix it by downgrading Gradle. Gradle 8.x ships Kotlin 1.9.25
and Expo modules require ≥ 2.1.20, so you trade one hard failure for another.
Expo's pinned Gradle 9.3.1 is correct; the JDK is the missing piece.

Android Studio's bundled JBR (JDK 21) is fine for `JAVA_HOME` — Gradle picks the
17 toolchain separately once it exists.

### `mobile/android/` is generated and gitignored

`expo prebuild` recreates it from `app.json` and wipes local edits. Never fix a
build problem by editing `android/` directly — the fix must go in `app.json`,
a config plugin, or this file. That is why the JDK requirement is documented
here rather than patched into `gradle.properties`.

```bash
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

⚠️ **The release APK is signed with the DEBUG keystore** — Expo's template
default (`signingConfig signingConfigs.debug`). It installs fine by sideloading
and is what you want for internal testing, but Google Play will reject it, and
switching to a real keystore later forces every existing installer to uninstall
first, because Android refuses an upgrade whose signature changed.

## Layout

```
mobile/
  app/                       expo-router routes (file = route)
    _layout.tsx              providers, session hydration, auth-failure → navigate
    index.tsx                cold-launch redirect
    login | forgot-password | reset-password | change-password
    accept-invitation | complete-profile | unauthorized
    onboarding/              consultant + recruiter gates
    (app)/                   signed-in group, wrapped in <RouteGuard>
      _layout.tsx            role-aware bottom tabs + More
      dashboard.tsx          three role variants in one route
      more.tsx               the full gated nav model
      …                      one file per module
  src/
    config/env.ts            validated EXPO_PUBLIC_* config
    services/session.ts      SecureStore-backed session (Keychain / Keystore)
    services/api.ts          axios + dedup + 429 cooldown + refresh + resume
    context/AuthContext.tsx  port of the web's, guard-for-guard
    hooks/                   useApi, useRealtime, useFeatureFlags, useBadgeCounts,
                             useInvalidate
    components/ui/           Button, Card, Pill, Sheet, Inputs, States, Screen…
    navigation/navModel.ts   port of the web Sidebar's NAV_SECTIONS
    theme/                   design tokens ported from tokens.css
    types/                   re-exports @hireorbitai/shared + domain shapes
```

## The five things that differ from the web

Everything else is a deliberate port. These are the real divergences:

### 1. Tokens live in the OS secure enclave

Web uses `localStorage`. On a phone that would mean plaintext tokens in a file
readable by any rooted device or unencrypted backup — and the refresh token is a
**30-day** credential. `src/services/session.ts` uses `expo-secure-store`
(Keychain / Keystore) with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so it survives
a background launch but never migrates to a new device via iCloud.

SecureStore is async where `localStorage` was synchronous. The bridge is a
single `hydrateSession()` awaited behind the splash screen in `app/_layout.tsx`;
after that `getSession()` is synchronous and every downstream consumer reads
exactly like the web's.

### 2. Refresh on resume

The web refreshes ~60s before expiry, which always fires because a browser tab
runs continuously. **A phone app gets suspended** and can resume hours after the
token died. Without `startResumeRefresh()` (in `services/api.ts`), the first
request after every resume 401s and boots the user — which reads as "the app
logged me out overnight".

### 3. Navigation, not `window.location`

The web interceptor calls `window.location.replace('/login')` directly. Here a
401/423 emits on an auth-failure channel and `app/_layout.tsx` navigates.
Reaching for the router inside a service module would create an import cycle
with the layout that mounts it.

### 4. SSE is foreground-only ⚠️

This is the most important operational fact about this app.

Realtime uses the same transport as the web — Postgres `LISTEN/NOTIFY` → SSE,
with the same single-use token handshake via `POST /realtime/token`. Two things
differ:

- React Native has no global `EventSource`; we use `react-native-sse`.
- **iOS and Android tear down sockets when the app is backgrounded.** So
  `useRealtime` deliberately closes on background and reopens on foreground
  rather than pretending a dead socket is alive. It fires `onReconnect` so the
  screen can refetch what it missed.

**Consequence: events that occur while the app is backgrounded are never
delivered.** A user will not learn about a new message or an incoming call until
they reopen the app.

Closing that gap requires **push notifications (APNs/FCM), which do not exist in
the backend today**. The work is: a `device_tokens` table, a
register/unregister endpoint, and a send path hooked into the points that
already call `publishToUser()` in `backend/src/services/realtime.service.ts`.
Until then, treat realtime as a live-view enhancement, not a delivery guarantee.

### 5. Touch targets and input sizing

`.claude/rules/frontend-responsive.md` pins web controls to `h-9` (36px) so
toolbars align, and requires a 44px minimum touch target on mobile. 36 < 44, so
the phone equivalent is **48px** (`controlHeight` in `theme/tokens.ts`), applied
uniformly to Button, FormInput and SelectInput — same alignment property, correct
size for a thumb. Text inputs are never below 16px, for the same readability
reason the web's iOS-zoom rule encoded.

Select controls open a **bottom sheet**, not an anchored dropdown: a web-style
popover overflows small screens and lands out of thumb reach.

## What still needs backend work

None of these block the app from running; all of them are real.

| #   | Item                   | Status                                                                                                                                                                                                                                                                           |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Push notifications** | Not built. Required for background delivery — see §4                                                                                                                                                                                                                             |
| 2   | **API versioning**     | Absent. Web deploys in lockstep with the backend; an app cannot. Users sit on old builds for months and app-store review adds days. A response-shape change breaks every un-updated phone. Decide on `/api/v1` or a min-version header **before** the API surface widens further |
| 3   | **`multer@1.x` CVEs**  | Open. Live on the upload path; a second client widens that surface                                                                                                                                                                                                               |
| 4   | **Deep links**         | `app.json` declares `applinks:hireorbitai.com` and an Android autoVerify filter. The server still needs `apple-app-site-association` + `assetlinks.json` published, and `brevo.service.ts` links still point at `FRONTEND_URL`                                                   |

CORS needed **no** change: native HTTP sends no `Origin` header, and
`server.ts` already allows that case (`if (!origin) return cb(null, true)`).
This would not have been true for Capacitor, which sends
`Origin: capacitor://localhost`.

## Rules that carry over

The app is bound by the same repo rules as the web client:

- **Authorization is server-side.** `RouteGuard` and `navModel` are convenience
  only. A tampered client bypasses both and still gets 403/404 from the backend.
  Never treat a client-side gate as the boundary.
- **Never reimplement role logic.** Import it from `@hireorbitai/shared`.
- **Adopt the shared primitives** (`Button`, `Pill`, `EmptyState`, `Skeleton`,
  `Sheet`, `ListScreen`). Add a new `Pill` tone; don't restyle one off.
- **Cross-screen refresh** goes through `invalidate('channel')`. This matters
  _more_ here than on the web: React Navigation keeps previous screens mounted,
  so a stale list is still alive underneath the current screen.
