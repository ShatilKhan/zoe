import { describe, expect, it } from "vitest";
import { canCommitDecryptedContent, stateAfterAuthChange } from "./sessionGuard";

describe("clinician decrypted-state guard", () => {
  const decrypted = { status: "ready" as const, payload: { patientDisplayName: "Synthetic Patient" } };

  it("replaces already-decrypted content on sign-out", () => {
    expect(stateAfterAuthChange(decrypted, "clinician-a", null)).toEqual({ status: "signed-out", keyWasDiscarded: false });
  });

  it("replaces already-decrypted content on account switch", () => {
    expect(stateAfterAuthChange(decrypted, "clinician-a", "clinician-b")).toEqual({ status: "ready-to-open" });
  });

  it("keeps content only for the same authenticated account", () => {
    expect(stateAfterAuthChange(decrypted, "clinician-a", "clinician-a")).toBe(decrypted);
  });

  it("rejects an in-flight decrypt after sign-out or account switch", () => {
    expect(canCommitDecryptedContent("clinician-a", null)).toBe(false);
    expect(canCommitDecryptedContent("clinician-a", "clinician-b")).toBe(false);
    expect(canCommitDecryptedContent("clinician-a", "clinician-a")).toBe(true);
  });
});
