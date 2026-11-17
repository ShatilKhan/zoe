# ADR-001: npm workspaces and Turborepo for Zoe

**Status:** Accepted for the synthetic-data MVP; native integrations remain release gates
**Proposed:** 17 November 2026
**Accepted:** 18 November 2026
**Decider:** Product owner

## Context

Zoe has an Android Expo app, a small clinician web viewer, three pure TypeScript packages, and three local Kotlin Expo modules. The challenge deadline is 22 November 2026. The team has no budget for a running server. Native package installation and Android build compatibility are critical.

## Decision

Use one repository with **npm workspaces**, one `package-lock.json`, and **Turborepo** for local task ordering. Start the mobile app from the plain Expo SDK 58 template. Keep device code in `apps/mobile` and `modules/*`. Keep shared packages pure. Add the clinician viewer as a static React + Vite app. Use Supabase for cloud configuration and migrations.

```text
apps/mobile/                 Expo SDK 58 Android app
apps/clinician-web/          Static React viewer
packages/records/            Record types, source rules, local retrieval
packages/nutrition/          Food matches, portion units, nutrient arithmetic
packages/share-contract/     Versioned encrypted bundle format
modules/presage-sensor/       SmartSpectra Kotlin bridge
modules/prescription-mask/    Opaque bitmap mask for optional Rx image share
modules/share-crypto/         Kotlin AES-GCM bridge
tools/ocr-training/           Local OCR labels, fine-tune and export checks; no images
tests/e2e-web/                Playwright on Expo web and clinician viewer
tests/e2e-android/            Maestro flows and synthetic Android fixtures
supabase/                    SQL migrations, RLS, Edge Function
package.json                 npm workspaces
package-lock.json            One lockfile
turbo.json                   Local task graph
```

The selected runtime is React Native ExecuTorch 0.10.6 for Qwen3 0.6B and PP-OCRv6 Small. Its release states support for Expo SDK 58. Chat dictation uses `expo-speech-recognition` in required on-device mode. Nutrition arithmetic uses a pinned offline food subset in a pure TypeScript package; Qwen3 explains reviewed results. Expo SDK 58 targets compile SDK 37, above Presage's 36.1 requirement. This is one app build path. The worker can verify most flows unattended in Expo web and a local KVM Android emulator, then build the direct-install APK for the owner's final live-camera and speech check. A Spark-plan Firebase Test Lab physical run can add unattended hardware smoke coverage without changing the runtime architecture.

## Package and task rules

1. `apps/mobile` owns the vault, Supabase client, sensor, offline speech input, first-pass OCR and suggested Rx region with patient adjustment, model, and share encryption adapters. `modules/prescription-mask` makes a separate, raster-redacted image for optional sharing; it cannot upload or read keys.
2. `packages/records` cannot import React Native, network clients, keys, or model runtimes. It returns facts and curated medicine-label excerpts with source IDs.
3. `packages/nutrition` owns food IDs, portion conversion, and deterministic totals. It has no UI, model, network, or record-vault access.
4. `packages/share-contract` defines the envelope version and metadata. It does not contain keys or network code.
5. `apps/clinician-web` decrypts a selected bundle in the browser. It has no model, analytics, or server process.
6. `supabase/` stores identity and ciphertext-relay rules. It never contains patient plaintext.
7. Turbo `dev` tasks are persistent and uncached. Cache only local type checks, lint, and pure-package tests. Do not cache native builds, secrets, patient files, or model inputs.
8. Use synthetic fixtures. Keep native dependencies pinned and verify Expo autolinking with the npm workspace layout.
9. ExecuTorch's postinstall step reads its native-library configuration from the install root. Put the `react-native-executorch` config in the root `package.json`. Include `arm64-v8a` for the target phone **and `x86_64` for the local Android emulator**. Keep one mobile app; local debug and EAS preview APKs differ only by build profile.
10. Use Infisical CLI for local development credentials and EAS secret variables for remote APK builds. No Infisical token or Supabase service-role key enters the mobile app. The Presage demo key remains extractable if compiled into the sideloaded APK; scope and rotate it. Do not claim live Presage support until the real SDK is linked and a device test passes.
11. `tools/ocr-training` may contain reproducible PP-OCRv6 recognizer training and `.pte` export definitions. Keep real prescription images, app-user corrections, checkpoints, and temporary crops outside Git and Turbo caches. The mobile app uses a trained checkpoint only after rights, label, export, and phone accuracy gates pass.
12. Keep Playwright and Maestro test artifacts local and synthetic. Android instrumented tests may exercise Presage with its official custom video-input API; keep any consented face clip outside Git and cloud test services unless its rights permit that use. Do not cache images or health-like test content in Turbo.

## Alternatives considered

| Option | Benefit | Cost for this MVP | Decision |
| --- | --- | --- | --- |
| npm workspaces alone | Fewest tools | Manual task order across app, web, and packages | Viable but weaker agent handoff |
| npm workspaces + Turborepo | Small task graph and clear package boundaries | One extra config file and cache policy | **Selected** |
| Bun workspaces + Turborepo | Fast installs; Bun is installed locally | Another behavior variable for native postinstall packages | Do not use for this build |
| pnpm workspaces + Turborepo | Strong workspace controls | Not installed here; isolated layout can need native adjustments | Do not use for this build |
| Nx | Generators and rich graph | More configuration for two apps | Do not use for this build |
| Better T Stack scaffold | Good CLI and agent workflows | Can add server components that the selected stack does not need | Do not use for this build |
| Separate repositories | Strong app isolation | Duplicated contracts and two release workflows | Poor fit |

## Consequences

- The worker can implement one mobile build and one static viewer with shared record and encryption formats.
- The repository does not need a Docker service or a custom API server.
- A native dependency or Presage build failure is a release risk. Do not mask it by starting a second architecture. Report the exact failure and reduce optional scope while keeping the chosen stack.
- Real patient use needs a separate security and recovery review. The hackathon build uses synthetic data.

## Sources

- [Expo monorepo guide](https://docs.expo.dev/guides/monorepos/)
- [Expo SDK versions](https://docs.expo.dev/versions/latest/)
- [Turborepo repository structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)
- [Turborepo task configuration](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)
- [ExecuTorch 0.10.6 release](https://github.com/software-mansion/react-native-executorch/releases/tag/v0.10.6)
- [ExecuTorch monorepo and Android ABI notes](https://docs.swmansion.com/react-native-executorch/docs/0.10.x/other/troubleshooting)
- [Presage Android setup](https://smartspectra.presagetech.com/docs/android/option-1-api-key/)
- [Presage Android metrics](https://smartspectra.presagetech.com/docs/android/metrics/)
- [Expo Speech Recognition](https://github.com/jamsch/expo-speech-recognition/blob/main/README.md)
- [Expo ImageManipulator](https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/)
- [Infisical pricing](https://infisical.com/pricing)
- [Infisical CLI](https://infisical.com/docs/cli/reference)
- [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/)
- [Presage Android headless testing](https://smartspectra.presagetech.com/docs/android/headless-testing-in-ci/)
- [Maestro Android testing](https://docs.maestro.dev/get-started/supported-platform/android)
- [Firebase Test Lab no-cost quotas](https://firebase.google.com/docs/test-lab/usage-quotas-pricing)
