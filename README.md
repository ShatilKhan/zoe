# Zoe

Zoe is an Android-first, patient-controlled health-history app built for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04). The selected MVP lets a patient keep reviewed records, ask sourced questions about records, medicines, and meals, see optional live wellness readings, and share selected encrypted records with a clinician. A small web viewer opens invited shares.

**Current state:** implementation is in progress. A local debug APK runs a synthetic, device-encrypted passphrase vault on an Android emulator. The live SmartSpectra, on-device OCR/model/speech, hosted sharing, and bundled preview APK gates are still being built and tested. Zoe is not a complete or clinically validated app. Use synthetic data only.

## Repository

| Path | Purpose |
| --- | --- |
| `apps/mobile` | Expo SDK 58 / React Native patient app for Android, with web preview for UI checks |
| `apps/clinician-web` | React + Vite clinician viewer for static hosting |
| `packages/records` | Record types, provenance, and local retrieval rules |
| `packages/nutrition` | Offline food matching and deterministic nutrient math |
| `packages/share-contract` | Versioned encrypted-share format and validation |
| `modules/*` | Local Kotlin Expo modules for sensor, masking, and cryptography |
| `supabase` | Auth/share database migration, policies, and download Edge Function |
| `tests/e2e-web` | Playwright browser flows |
| `docs` | [Architecture decision](docs/ADR-001-monorepo.md), [product decision](docs/PDR-001-product-scope.md), and [design contract](docs/design.md) |

The [MVP specification](MVP_SPEC.md) contains the acceptance and safety gates. The [HTML proposal](proposal.html) shows the architecture and screen designs.

## Local setup

Requirements: Node.js and npm, JDK 17, Android SDK with platform/build tools and an emulator or Android phone. Custom native modules require a development or preview build; Expo Go cannot load them. Cloud sharing also needs a Supabase project configured with the reviewed migration and function. The mobile app requires a **publishable** Supabase key for cloud sign-in; a service-role key must never enter a mobile or web bundle.

```bash
npm ci
npm run check
```

For a browser UI preview:

```bash
cd apps/mobile
npx expo start --web
```

For a local Android debug build, set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` to your installed JDK/SDK, start an emulator, and run:

```bash
cd apps/mobile
npx expo run:android
```

A debug APK loads JavaScript from Metro. To launch a previously built debug APK, run `npx expo start --localhost --port 8081` from `apps/mobile` and `adb reverse tcp:8081 tcp:8081` before opening the app. A preview APK built through EAS must be tested separately because it embeds the JavaScript bundle.

The clinician viewer can be previewed locally:

```bash
cd apps/clinician-web
npm run dev
```

Public client configuration uses `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_CLINICIAN_VIEWER_URL` for mobile; the viewer uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not commit `.env` files or privileged keys. The full Presage key belongs in a secure build input and must be scoped and rotated because a key compiled into an APK can be extracted.

## Verification and limits

`npm run check` runs workspace type checks, unit tests, browser flows, and web builds. The local Android debug build has compiled and installed on an API 34 emulator. A synthetic passphrase vault was created, locked on background, denied a wrong passphrase, and reopened after process restart; a raw-file check found no plaintext SQLite header or synthetic record marker. The local Supabase migration passed 18 pgTAP authorization assertions. The Supabase migration, Edge Function, and Cloudflare Pages viewer have **not** been deployed to hosted services, and a bundled preview APK has not been tested. Do not infer native model, OCR, speech, or sensor behavior from the web tests or Kotlin compilation.

Zoe answers medicine and nutrition questions with supported facts and stated uncertainty. It must not diagnose, prescribe, select a dose, or assert that a medicine is safe for a specific person without adequate evidence. The hackathon build is for synthetic demonstration. Real patient use needs separate clinical, privacy, security, and recovery review.
