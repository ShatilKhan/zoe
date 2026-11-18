import { describe, expect, it } from "vitest";
import { SYNTHETIC_RECORDS } from "@zoe/records";
import { recordsForOpenedVault } from "./recordBootstrap";

describe("vault record bootstrap", () => {
  it("seeds only a brand-new explicitly synthetic preview", () => {
    expect(recordsForOpenedVault([], true, true, SYNTHETIC_RECORDS)).toEqual(SYNTHETIC_RECORDS);
    expect(recordsForOpenedVault([], false, true, SYNTHETIC_RECORDS)).toEqual([]);
    expect(recordsForOpenedVault([], true, false, SYNTHETIC_RECORDS)).toEqual([]);
  });

  it("never replaces existing records", () => {
    const existing = [SYNTHETIC_RECORDS[0]!];
    expect(recordsForOpenedVault(existing, false, false, SYNTHETIC_RECORDS)).toBe(existing);
  });
});
