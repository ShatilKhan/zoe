import { describe, expect, it } from "vitest";
import { UnlockRateLimiter, parseBundle, parseMetadata, validateNewPassphrase, vaultNames } from "./vaultPolicy";

describe("vault policy", () => {
  it("requires a strong, account-independent passphrase", () => {
    expect(validateNewPassphrase("1234567890123456", "account-a")).toBeTruthy();
    expect(validateNewPassphrase("correct horse battery staple", "account-a")).toBeTruthy();
    expect(validateNewPassphrase("account-a!LongerSecret7", "account-a")).toBeTruthy();
    expect(validateNewPassphrase("Maple!Orbit7 Glass River", "account-a")).toBeNull();
  });

  it("uses account-specific namespaces", () => {
    expect(vaultNames("account-a")).not.toEqual(vaultNames("account-b"));
    expect(vaultNames("account-a").kdfNamespace).toBe("account-a:passphrase");
  });

  it("rejects copied or tampered metadata", () => {
    const salt = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
    const deviceSecret = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
    const bundle = JSON.stringify({ version: 1, userId: "account-a", mode: "passphrase", salt, deviceSecret });
    expect(parseBundle(bundle, "account-a").userId).toBe("account-a");
    expect(() => parseBundle(bundle, "account-b")).toThrow("another account");
    expect(() => parseBundle(JSON.stringify({ version: 1, userId: "account-a", mode: "passphrase", salt: "c2FsdA==", deviceSecret: "c2VjcmV0" }), "account-a")).toThrow("lengths");
    expect(() => parseMetadata(JSON.stringify({ version: 2, userId: "account-a", mode: "passphrase", initialized: true, salt: "salt" }), "account-a")).toThrow("changed");
  });

  it("does not treat punctuation-only account IDs as an empty passphrase substring", () => {
    expect(validateNewPassphrase("Maple!Orbit7 Glass River", "___")).toBeNull();
  });

  it("rate-limits repeated UI attempts without claiming offline protection", () => {
    const limiter = new UnlockRateLimiter();
    for (let attempt = 0; attempt < 4; attempt += 1) expect(limiter.recordFailure(1_000)).toBe(0);
    expect(limiter.recordFailure(1_000)).toBe(5_000);
    expect(limiter.remainingMs(2_000)).toBe(4_000);
    limiter.recordSuccess();
    expect(limiter.remainingMs(2_000)).toBe(0);
  });
});
