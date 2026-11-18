import { isGrantAvailable, secureResponseHeaders, type DownloadGrant } from "./policy.ts";

export interface DownloadShareDependencies {
  configured: boolean;
  allowedOrigin: string;
  authenticate(token: string): Promise<string | null>;
  findGrant(objectId: string, recipientId: string): Promise<DownloadGrant | null>;
  downloadObject(path: string): Promise<string | null>;
  writeAudit(grantId: string, actorId: string): Promise<boolean>;
  now?: () => number;
}

function json(request: Request, allowedOrigin: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: secureResponseHeaders(request.headers.get("Origin"), allowedOrigin) });
}

export async function handleDownloadShare(request: Request, dependencies: DownloadShareDependencies): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== dependencies.allowedOrigin) return json(request, dependencies.allowedOrigin, 403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: secureResponseHeaders(origin, dependencies.allowedOrigin) });
  if (request.method !== "POST") return json(request, dependencies.allowedOrigin, 405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, dependencies.allowedOrigin, 401, { error: "authentication_required" });
  if (!dependencies.configured) return json(request, dependencies.allowedOrigin, 500, { error: "server_configuration_error" });

  let objectId: string;
  try {
    const body = await request.json() as { objectId?: unknown };
    if (typeof body.objectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.objectId)) {
      return json(request, dependencies.allowedOrigin, 400, { error: "invalid_object_id" });
    }
    objectId = body.objectId;
  } catch {
    return json(request, dependencies.allowedOrigin, 400, { error: "invalid_json" });
  }

  const actorId = await dependencies.authenticate(authorization.slice("Bearer ".length));
  if (!actorId) return json(request, dependencies.allowedOrigin, 401, { error: "invalid_session" });
  const grant = await dependencies.findGrant(objectId, actorId);
  if (!isGrantAvailable(grant, actorId, objectId, (dependencies.now ?? Date.now)())) return json(request, dependencies.allowedOrigin, 404, { error: "share_unavailable" });
  const encodedEnvelope = await dependencies.downloadObject(`${grant.patient_id}/${grant.object_id}.bin`);
  if (encodedEnvelope === null) return json(request, dependencies.allowedOrigin, 404, { error: "share_unavailable" });
  if (!await dependencies.writeAudit(grant.id, actorId)) return json(request, dependencies.allowedOrigin, 503, { error: "audit_unavailable" });
  return json(request, dependencies.allowedOrigin, 200, {
    encodedEnvelope,
    grant: { grantId: grant.id, patientId: grant.patient_id, recipientId: grant.recipient_id, objectId: grant.object_id, expiresAt: grant.expires_at }
  });
}
