# Zoe

Zoe is an Android-first, patient-controlled health-history app built for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04). This patient release keeps reviewed records in a local encrypted vault, answers questions from confirmed records and a synthetic nutrition catalog, supports editable offline dictation, and provides an optional front-camera wellness check.

**Current state:** implementation remains in progress. Use synthetic data only. Zoe is not a diagnostic, prescribing, treatment, or emergency tool. OCR, on-device Qwen, live SmartSpectra capture, and physical-device speech/network audits are not yet complete.

## Repository

| Path | Purpose |
| --- | --- |
| `apps/mobile` | Expo SDK 58 / React Native patient app for Android, with web preview for UI checks |
| `packages/records` | Record types, provenance, and local retrieval rules |
| `packages/nutrition` | Offline food matching and deterministic nutrient math |
| `modules/presage-sensor` | SmartSpectra Android bridge; fails closed without secure build configuration |
| `modules/share-crypto` | Android vault-key derivation used by the SQLCipher vault |
| `modules/prescription-mask` | Native prescription-image masking boundary |
| `tests/e2e-web` | Patient-only Firefox preview flows |

## Local setup

Requirements: Node.js and npm, JDK 17, and Android SDK platform/build tools. Custom native modules require a development or preview build; Expo Go cannot load them.

```bash
npm ci
npm run check
```

Run patient UI preview with synthetic browser storage:

```bash
cd apps/mobile
npx expo start --web
```

The preview opens through **Unlock synthetic preview**. It contains only synthetic records. Browser storage is not SQLCipher and does not prove Android vault behavior.

Patient email OTP sign-in uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Only a publishable client key belongs in the app. Signed-in account identifiers remain internal vault namespaces and are not shown in patient-facing copy.

## Android builds

For a local debug build, set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`, then run:

```bash
cd apps/mobile
npx expo run:android
```

A debug APK loads JavaScript from Metro. A standalone preview APK embeds its JavaScript bundle:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

`apps/mobile/eas.json` keeps preview output as an installable APK. Presage credentials must come from secure build input. App compiles without that key and reports wellness sensor unavailable; no secret belongs in source, `.env`, logs, or APK verification reports.

## Verification and limits

`npm run check` runs workspace type checks, unit tests, patient Firefox flows, and web builds. Native correctness requires a separate Android build and device test. Web tests do not prove SQLCipher, Keystore, offline speech, camera behavior, or absence of network traffic.

Zoe shows provenance and uncertainty, rejects unconfirmed records at safety boundaries, and does not invent sensor values. Real patient use needs separate clinical, privacy, security, recovery, accessibility, and device validation.
