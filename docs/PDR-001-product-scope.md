# PDR-001: Patient-controlled health history MVP

**Status:** Accepted as the synthetic-data hackathon build target; release gates remain open
**Proposed:** 17 November 2026
**Implementation authorized:** 18 November 2026
**Owner:** Zoe product owner

## Product decision

Zoe helps a patient keep a corrected health history, ask questions about it, and share chosen records with a clinician. It is an Android-first Expo app with a small clinician web viewer. The Presage SmartSpectra screen supplies optional wellness readings. Zoe does not diagnose, prescribe, choose a dose, or make a treatment decision.

Medicine, allergy, symptom, diet, and nutrition questions **are in scope**. Zoe should answer naturally using known facts and cited reference content, state missing information, and direct the patient to a clinician when personal safety cannot be established. A greeting or ordinary conversation must work without loading the full model. A refusal is reserved for a specific unsafe request; it is not the default answer to a medicine question.

## Users and jobs

| User | Job | MVP proof |
| --- | --- | --- |
| Patient | Add, correct, find, and understand personal records | A confirmed record survives an app restart in the right encrypted account vault. |
| Patient | Import a prescription without manual cropping | Local text extraction proposes the medicine area; the patient reviews each field before saving. |
| Patient | Ask about medicines, allergies, symptoms, meals, and records | Answer cites the exact saved fact or approved reference, states uncertainty, and never invents a safety verdict. |
| Patient | See a live wellness reading | With camera consent, real SDK pulse and breathing values appear with quality/freshness state; the patient may save a reading. |
| Patient | Share selected records | A recipient and exact record set are confirmed, then a time-limited ciphertext link opens only for that account and can be revoked. |
| Clinician | Sign up and read an invitation | A self-declared clinician account enrolls for sharing; it sees only invited records until expiry or revocation. |

Clinician identity is **self-declared** in this prototype. No interface may call it verified or imply clinical credential checks.

## MVP journeys

1. Show the supplied Zoe mark on the native splash, then a short app-layer logo transition before sign-in or unlock. An existing account opens its own encrypted vault.
2. Add a condition, allergy, medicine, visit, or meal in a form. Draft data stays separate from confirmed facts. A correction never silently retrains or updates a model.
3. Import a prescription photo without mandatory cropping. A local OCR pass proposes the Rx area and candidate fields. The patient can adjust the area, correct text, or enter a line manually. Unreadable text remains unknown. Retain original-image provenance privately; create a separate, pixel-redacted raster only if the patient elects to share an image.
4. Type or dictate into the same editable chat composer. Route greetings and simple navigation quickly. Retrieve local records and approved offline reference content before the on-device model writes a cited response. Nutrition numbers come from deterministic code and a pinned catalog, with portion assumptions shown.
5. Start and stop a front-camera SmartSpectra session after consent. Show pulse and breathing rates, signal quality, freshness, and positioning guidance. Save only a patient-approved reading; never save face video.
6. Select confirmed records, resolve a self-declared recipient account, inspect the exact selection and expiry, then encrypt and upload the chosen bundle. The clinician signs in, opens the link, and can sign out. Expiry and revocation stop future downloads.

## Data and safety contract

| Data | Location and rule |
| --- | --- |
| Readable record text, prescription original, OCR result, chat draft, model prompt/output, speech transcript, sensor values | Patient device and its account-specific encrypted vault. No content telemetry or cloud LLM. |
| Selected share | Client-encrypted before upload. Supabase holds ciphertext, account IDs, grant scope, expiry, and minimal access audit. The fragment key is removed from browser URL as soon as it is captured. |
| Build keys | Infisical and EAS build environment only. Service-role keys never ship to app/browser. A Presage demo key compiled into an APK is extractable and must be scoped and rotated. |
| Training and evaluation | Synthetic or rights-cleared public material only. App-user corrections are not uploaded to training or analytics. |

The patient must explicitly choose any content that leaves the device. Sharing encrypted bundles is part of this MVP decision; the cloud never receives plaintext. Presage may validate its subscription; telemetry must be disabled before sensor readiness or capture. Do not claim Zoe can encrypt SDK-owned telemetry.

## Scope decisions and alternatives

| Option | Decision | Reason |
| --- | --- | --- |
| On-device chat and OCR | Selected, subject to Android runtime and quality gates | Keeps readable history and images off cloud AI. |
| Cloud AI for patient records | Rejected for this build | It would send readable personal context outside the phone. |
| Fully local app with no cloud | Rejected for this build | It cannot serve a clinician link across devices. |
| Booking and doctor marketplace | Later | The record → question → share journey is the hackathon proof. |
| Verified clinician identity | Later | The free MVP lacks a trustworthy credential-verification process. |
| X-ray or diagnostic-image interpretation | Later | The first import path is medicine text on written prescriptions. |
| Automatic OCR corrections as training feedback | Rejected | Patient corrections are personal data and may be wrong; they must not become automatic labels. |

## Acceptance and release gates

- An installed Android preview APK completes account unlock, reviewed record/prescription, sourced question, microphone transcription into the composer, live sensor session, selected share, clinician view, and revoke using **synthetic data**. Expo web is a fast UI lane, not proof of native behavior.
- The mobile app fails closed when an OCR/model/speech/sensor capability is unavailable. It never labels a deterministic placeholder as AI or a static reading as live.
- Native tests cover SQLCipher linkage, account isolation and lock/background behavior, mask pixels and metadata, crypto interoperability and tamper rejection, OCR review/provenance, offline model routing, and speech state. Backend tests cover RLS, direct Storage denial, wrong recipient, expiry, revocation, audit, and fragment handling.
- Assistant evaluation uses fixed synthetic cases for greetings, ambiguous medicines, allergy and safety questions, meals, urgent symptoms, Bengali/Banglish, source fidelity, timeout, cancellation, duplicate sends, and account changes. No critical case may produce a false all-clear, treatment instruction, wrong-patient fact, or invalid citation.
- A reviewer checks the exact source content behind safety answers. A passed build or synthetic benchmark is not clinical validation. Real patient use requires separate clinical, privacy, security, recovery, and legal review.

The full behavior matrix, data sources, test thresholds, and threat analysis are in [the MVP spec](../MVP_SPEC.md). Technical boundaries and monorepo tradeoffs are in [ADR-001](ADR-001-monorepo.md). Screen states are in [design.md](design.md) and the [HTML proposal](../proposal.html#screens).

## Change control

The owner authorized implementation and incremental commits on 18 November 2026. This supersedes the planning-only sentence in the earlier draft spec. This PDR records the current product target. Any change to readable-data egress, medical advice boundary, clinician identity claim, or share scope needs an explicit PDR revision before release.
