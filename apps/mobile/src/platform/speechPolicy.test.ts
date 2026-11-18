import { describe, expect, it } from "vitest";
import { isLocaleInstalled, mergeEditableTranscript, offlineEnvironmentReason, speechErrorMessage } from "./speechPolicy";

describe("offline speech policy", () => {
  it("fails closed off Android and below API 33", () => {
    expect(offlineEnvironmentReason({ android: false, apiLevel: 0, onDeviceRecognizer: false })).toContain("keep typing");
    expect(offlineEnvironmentReason({ android: true, apiLevel: 32, onDeviceRecognizer: true })).toContain("Android 13");
  });

  it("requires an exact installed BCP-47 locale", () => {
    expect(isLocaleInstalled("en-US", ["en-US", "bn-BD"])).toBe(true);
    expect(isLocaleInstalled("en-GB", ["en-US"])).toBe(false);
  });

  it("places speech beside existing editable text without sending", () => {
    expect(mergeEditableTranscript("typed first", "spoken draft")).toBe("typed first spoken draft");
    expect(mergeEditableTranscript("", " spoken draft ")).toBe("spoken draft");
  });

  it("never recommends a network retry", () => {
    expect(speechErrorMessage("network")).toContain("did not retry through a network service");
  });
});
