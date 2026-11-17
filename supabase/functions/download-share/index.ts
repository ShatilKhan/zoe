import { createClient } from "npm:@supabase/supabase-js@2.119.0";

function responseHeaders(request: Request, contentType = "application/json") {
  const origin = request.headers.get("Origin");
  const allowedOrigin = Deno.env.get("ALLOWED_VIEWER_ORIGIN") ?? "https://zoe-clinician-preview.pages.dev";
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

function json(request: Request, status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = Deno.env.get("ALLOWED_VIEWER_ORIGIN") ?? "https://zoe-clinician-preview.pages.dev";
  if (origin && origin !== allowedOrigin) return json(request, 403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request) });
  if (request.method !== "POST") return json(request, 405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, 401, { error: "authentication_required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return json(request, 500, { error: "server_configuration_error" });

  let objectId: string;
  try {
    const body = await request.json() as { objectId?: unknown };
    if (typeof body.objectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.objectId)) {
      return json(request, 400, { error: "invalid_object_id" });
    }
    objectId = body.objectId;
  } catch {
    return json(request, 400, { error: "invalid_json" });
  }

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json(request, 401, { error: "invalid_session" });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: grant, error: grantError } = await admin
    .from("share_grants")
    .select("id,patient_id,recipient_id,object_id,expires_at,revoked_at")
    .eq("object_id", objectId)
    .eq("recipient_id", userData.user.id)
    .maybeSingle();

  if (grantError || !grant || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now()) {
    return json(request, 404, { error: "share_unavailable" });
  }

  const path = `${grant.patient_id}/${grant.object_id}.bin`;
  const { data: object, error: downloadError } = await admin.storage.from("zoe-shares").download(path);
  if (downloadError || !object) return json(request, 404, { error: "share_unavailable" });

  const { error: auditError } = await admin.from("share_access_audit").insert({ grant_id: grant.id, actor_id: userData.user.id, outcome: "downloaded" });
  if (auditError) return json(request, 503, { error: "audit_unavailable" });
  return new Response(await object.arrayBuffer(), {
    status: 200,
    headers: { ...responseHeaders(request, "application/octet-stream"), "Content-Length": String(object.size) }
  });
});
