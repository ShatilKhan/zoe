import { describe, expect, it } from "vitest";
import { isGrantAvailable, requireAuditSuccess, secureResponseHeaders, type DownloadGrant } from "../../supabase/functions/download-share/policy";

const grant: DownloadGrant = {
  id: "grant-1",
  patient_id: "patient-a",
  recipient_id: "clinician-a",
  object_id: "object-a",
  expires_at: "2099-01-01T00:00:00.000Z",
  revoked_at: null
};

describe("download-share authorization policy", () => {
  it("accepts only the exact recipient and object", () => {
    expect(isGrantAvailable(grant, "clinician-a", "object-a", 0)).toBe(true);
    expect(isGrantAvailable(grant, "clinician-b", "object-a", 0)).toBe(false);
    expect(isGrantAvailable(grant, "clinician-a", "object-b", 0)).toBe(false);
  });

  it("rejects revoked, expired, malformed, and missing grants", () => {
    expect(isGrantAvailable({ ...grant, revoked_at: "2026-01-01T00:00:00Z" }, "clinician-a", "object-a", 0)).toBe(false);
    expect(isGrantAvailable({ ...grant, expires_at: "2020-01-01T00:00:00Z" }, "clinician-a", "object-a", Date.parse("2021-01-01T00:00:00Z"))).toBe(false);
    expect(isGrantAvailable({ ...grant, expires_at: "invalid" }, "clinician-a", "object-a", 0)).toBe(false);
    expect(isGrantAvailable(null, "clinician-a", "object-a", 0)).toBe(false);
  });

  it("fails closed when the access audit cannot be written", () => {
    expect(() => requireAuditSuccess(null)).not.toThrow();
    expect(() => requireAuditSuccess(new Error("database unavailable"))).toThrow("audit_unavailable");
  });

  it("allows only the configured viewer origin and disables caching", () => {
    const allowed = secureResponseHeaders("https://zoe-clinician-preview.pages.dev", "https://zoe-clinician-preview.pages.dev");
    expect(allowed["Access-Control-Allow-Origin"]).toBe("https://zoe-clinician-preview.pages.dev");
    expect(allowed["Cache-Control"]).toBe("no-store, max-age=0");
    const denied = secureResponseHeaders("https://attacker.example", "https://zoe-clinician-preview.pages.dev");
    expect(denied).not.toHaveProperty("Access-Control-Allow-Origin");
  });
});
