export interface DownloadGrant {
  id: string;
  patient_id: string;
  recipient_id: string;
  object_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export function isGrantAvailable(grant: DownloadGrant | null, actorId: string, objectId: string, now = Date.now()): grant is DownloadGrant {
  return Boolean(
    grant &&
    grant.recipient_id === actorId &&
    grant.object_id === objectId &&
    grant.revoked_at === null &&
    Number.isFinite(Date.parse(grant.expires_at)) &&
    Date.parse(grant.expires_at) > now
  );
}

export function secureResponseHeaders(origin: string | null, allowedOrigin: string, contentType = "application/json") {
  return {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(origin === allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin" } : {}),
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

export function requireAuditSuccess(error: unknown): void {
  if (error) throw new Error("audit_unavailable");
}
