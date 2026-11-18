import { describe, expect, it, vi } from "vitest";
import { handleDownloadShare, type DownloadShareDependencies } from "../../supabase/functions/download-share/handler";
import type { DownloadGrant } from "../../supabase/functions/download-share/policy";

const allowedOrigin = "https://zoe-clinician-preview.pages.dev";
const objectId = "00000000-0000-4000-8000-000000000020";
const recipientId = "00000000-0000-4000-8000-000000000002";
const grant: DownloadGrant = {
  id: "00000000-0000-4000-8000-000000000010",
  patient_id: "00000000-0000-4000-8000-000000000001",
  recipient_id: recipientId,
  object_id: objectId,
  expires_at: "2099-01-01T00:00:00.000Z",
  revoked_at: null
};

function request(method = "POST") {
  return new Request("https://example.test/functions/v1/download-share", {
    method,
    headers: { Origin: allowedOrigin, Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({ objectId }) } : {})
  });
}

function dependencies(overrides: Partial<DownloadShareDependencies> = {}): DownloadShareDependencies {
  return {
    configured: true,
    allowedOrigin,
    authenticate: vi.fn(async () => recipientId),
    findGrant: vi.fn(async () => grant),
    downloadObject: vi.fn(async () => "encoded-envelope"),
    writeAudit: vi.fn(async () => true),
    now: () => 0,
    ...overrides
  };
}

describe("download-share Edge handler", () => {
  it("handles preflight without invoking auth or storage", async () => {
    const deps = dependencies();
    const response = await handleDownloadShare(request("OPTIONS"), deps);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it("fetches and audits every successful request with no-store metadata", async () => {
    const deps = dependencies();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handleDownloadShare(request(), deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
      await expect(response.json()).resolves.toMatchObject({ encodedEnvelope: "encoded-envelope", grant: { recipientId, objectId } });
    }
    expect(deps.downloadObject).toHaveBeenCalledTimes(2);
    expect(deps.writeAudit).toHaveBeenCalledTimes(2);
  });

  it("returns no ciphertext when the audit write fails", async () => {
    const deps = dependencies({ writeAudit: vi.fn(async () => false) });
    const response = await handleDownloadShare(request(), deps);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "audit_unavailable" });
  });

  it("fails closed for invalid sessions and mismatched grants", async () => {
    const invalidSession = await handleDownloadShare(request(), dependencies({ authenticate: vi.fn(async () => null) }));
    expect(invalidSession.status).toBe(401);
    const deps = dependencies({ findGrant: vi.fn(async () => ({ ...grant, recipient_id: "00000000-0000-4000-8000-000000000003" })) });
    const mismatched = await handleDownloadShare(request(), deps);
    expect(mismatched.status).toBe(404);
    expect(deps.downloadObject).not.toHaveBeenCalled();
    expect(deps.writeAudit).not.toHaveBeenCalled();
  });
});
