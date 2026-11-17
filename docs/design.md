---
name: Zoe
description: Patient-controlled health history for Android and a narrow clinician viewer
colors:
  canvas: "#F6F6F0"
  surface: "#FFFFFF"
  ink: "#203A31"
  muted: "#50645A"
  outline: "#CAD5CC"
  quiet: "#E9F1D9"
  accent: "#DCEBB0"
  urgent: "#FAE9E7"
  urgent-ink: "#9E3D35"
typography:
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.3
rounded:
  control: "12px"
  surface: "18px"
spacing:
  compact: "8px"
  standard: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "48px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
---

# Zoe design contract

This document defines the intended Android MVP and clinician viewer. The [HTML screen proposal](../proposal.html#screens) is the visual reference; the current implementation scaffold can differ while work is in progress. The colors above are target roles from the proposal's design guidance, not a claim that every existing screen already uses them. Match the supplied Zoe mark at `assets/brand/zoe-mark-transparent.png`; preserve its silhouette and clear space.

## Overview

**Design read:** A private health record tool for patients and invited clinicians. It should feel calm, capable, and direct. Show the task or answer first, then evidence, uncertainty, and next action. Use Android's familiar navigation and controls. Brand belongs in the logo, type rhythm, and small color decisions; it must not interrupt a health task.

Five phone destinations have a visible icon and short label: **Home, Records, Ask, Wellness, Share**. Profile and Help open from Home. The clinician viewer has account entry, invitations, selected records, and unavailable-share states. The full screen inventory is in the HTML proposal. Do not add a separate voice-draft screen: speech fills the editable chat bar. The mic and send buttons are icons with accessible names. Navigation labels are visible, so they need no duplicate tooltips.

On compact Android, use a bottom navigation bar. On expanded width, adapt to a rail or drawer. Honor system Back, safe-area and keyboard insets, large text, and a 48 dp minimum touch target with at least 8 dp separation. Keep the composer above the keyboard and the selected record set visible before sharing.

**Motion rule:** Motion reports state. The static native splash and app-layer mark share a background; the intact mark settles for about 620 ms on cold start, then the correct route appears. Warm returns do not replay it. Android Remove animations and web reduced motion show the state without travel or a forced wait. Most action transitions take 150–250 ms; no fake thinking sequence or invented progress percentage.

## Colors

The target roles are in the frontmatter. Canvas and surface separate task space from content. Ink is for primary action, headings, and active navigation. Quiet and accent mark selected or actionable states with restraint. Urgent is reserved for a safety or error state and always carries an explicit text label. Do not encode medical risk as a color score.

Maintain at least 4.5:1 contrast for normal text and 3:1 for large text or essential icons. Verify real rendered contrast in light and dark modes before release. A dark theme needs its own role values and tests; do not invert screenshots or reuse a muted color that loses contrast. The clinician viewer must carry the same roles without implying that a clinician is credential-verified.

## Typography

Use one readable system sans family for product controls, records, and chat. Large, compact task titles establish hierarchy. Keep body lines short enough to scan; a long answer uses sections or source disclosure instead of a wall of prose. Labels and statuses use words such as **Draft**, **Patient reported**, **Reviewed**, **Unknown**, **Active**, **Expired**, and **Revoked**. Dates and provenance appear with every record fact and saved reading.

The target type roles are in the frontmatter. On Android, map them to platform text scaling so system font-size settings work; do not freeze body copy in pixels. Test English and Bengali/Banglish strings for clipping, line breaks, and reading order. The viewer's browser zoom and keyboard focus must preserve all actions.

## Elevation

Use tonal surfaces and a clear outline to group records, forms, and share details. A single active-task surface may carry stronger contrast. Do not stack nested cards or float controls over critical text. The photo review and sensor session may use an overlay only when it improves focus; keep Exit, Back, and Cancel clear. Avoid decorative shadows, glowing AI treatments, and medical stock imagery.

## Components

| Component | Required behavior |
| --- | --- |
| Navigation | One icon family; visible short labels on phone; active state also has text/shape; system Back works. No nav tooltips. |
| Chat composer | Editable transcript and typed draft share one field. Icon-only Mic and Send each have an accessible name and 48 dp target. Recording, loading, stop, cancel, retry, and disabled states are explicit. Duplicate Send cannot create duplicate work. |
| Answer | Lead with the answer or supported limit, then link exact record/reference sources, uncertainty, and useful next step. Medicine and nutrition cards are structured data, not decorative generative UI. |
| Record row | Show title, date, provenance, and review state. Correction is a form action. Unknown OCR fields cannot appear as confirmed medicine facts. |
| Prescription review | Import the whole image; suggest an Rx area from local text boxes; allow adjustment and line-by-line edit. Before Save, show all extracted and manually entered fields. An optional masked share copy is a separately rendered raster preview. |
| Wellness | Consent precedes camera. Show pulse and breathing values with signal quality, freshness, positioning help, Stop, and optional Save. Never display a static sample as live. |
| Share review | Show recipient's **self-declared** name/organization, exact selected records, and expiry. Any change to recipient or record selection invalidates confirmation. Show Active, Expired, Revoked, and failed states. |
| Clinician viewer | Sign-in, enrollment, invitations, record view, sign-out, and unavailable-share states. Clear decrypted content on sign-out, account change, expiry, and failed authorization. |
| Form and loader | Show errors beside the field or task. Use determinate progress only for measured work; otherwise show a restrained status, Cancel or Retry, and prior content where safe. |

Every interactive component needs default, pressed/hover, focus, disabled, loading, error, and success states where relevant. Web-only icon tooltips may appear on hover or focus and must dismiss on Escape or blur. Android uses content descriptions and visible state. TalkBack, keyboard, and reduced-motion tests must expose the same result.

## Do's and Don'ts

- **Do** use the supplied logo at original proportions on splash, patient entry/unlock, and clinician sign-in.
- **Do** show source and uncertainty when they change a health answer. Keep repeated explanation in Help or source detail.
- **Do** make a medicine lookup a local, reviewable match; require patient confirmation before it becomes a fact.
- **Do** preserve a clear recovery path for unreadable OCR, missing offline speech pack, model load failure, weak camera signal, and expired share.
- **Do** keep animation bounded, cancelable, and silent under reduced motion. An error or account switch must end a loader.
- **Don't** use fake clinician badges, diagnosis scores, stock doctor photos, glowing AI effects, or decorative dashboards.
- **Don't** use long button copy where a familiar icon and accessible name suffice; keep visible navigation labels.
- **Don't** describe a self-declared recipient as verified or a patient-entered field as OCR-confirmed.
- **Don't** let a model answer conceal its source gap, invent a nutrient value, or imply a medicine is safe for this patient.

The complete motion timings, safety states, and APK checks are in [the MVP spec](../MVP_SPEC.md#interaction-motion-and-loading-states). Product scope is in [PDR-001](PDR-001-product-scope.md).
