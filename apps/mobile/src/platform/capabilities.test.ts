import { describe, expect, it } from "vitest";
import { smartSpectraCapability } from "./capabilityPolicy";

describe("SmartSpectra capability", () => {
  it("is unavailable when the Android build has no secure SDK key", () => {
    expect(smartSpectraCapability(true, false)).toEqual({
      available: false,
      reason: "This build does not contain the required secure SmartSpectra key.",
    });
  });

  it("requires both Android and a build key", () => {
    expect(smartSpectraCapability(false, true).available).toBe(false);
    expect(smartSpectraCapability(true, true)).toEqual({ available: true });
  });
});
