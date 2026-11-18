import { describe, expect, it } from "vitest";
import { canCommitDecryptedContent, captureAndScrubShareReference, createOneShotReference, stateAfterAuthChange } from "./sessionGuard";

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

  it("captures a valid fragment key and scrubs it immediately", () => {
    const replacements: string[] = [];
    expect(captureAndScrubShareReference(
      { pathname: "/", search: "?objectId=00000000-0000-4000-8000-000000000020", hash: "#secret-key" },
      (url) => replacements.push(url)
    )).toEqual({ objectId: "00000000-0000-4000-8000-000000000020", key: "secret-key" });
    expect(replacements).toEqual(["/?objectId=00000000-0000-4000-8000-000000000020"]);
  });

  it("scrubs malformed fragment links before rejecting them", () => {
    const replacements: string[] = [];
    expect(() => captureAndScrubShareReference(
      { pathname: "/", search: "?objectId=bad", hash: "#secret-key" },
      (url) => replacements.push(url)
    )).toThrow("invalid");
    expect(replacements).toEqual(["/?objectId=bad"]);
  });

  it("erases the module capture when the app consumes or clears it", () => {
    const capture = createOneShotReference({ objectId: "00000000-0000-4000-8000-000000000020", key: "secret-key" });
    expect(capture.hasValue()).toBe(true);
    expect(capture.take()).toEqual({ objectId: "00000000-0000-4000-8000-000000000020", key: "secret-key" });
    expect(capture.hasValue()).toBe(false);
    expect(capture.take()).toBeNull();
    const discarded = createOneShotReference({ objectId: "00000000-0000-4000-8000-000000000020", key: "discard-me" });
    discarded.clear();
    expect(discarded.hasValue()).toBe(false);
  });
});
