import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { handleDownloadShare } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigin = Deno.env.get("ALLOWED_VIEWER_ORIGIN") ?? "https://zoe-clinician-preview.pages.dev";
const configured = Boolean(supabaseUrl && publishableKey && serviceRoleKey);

Deno.serve((request: Request) => handleDownloadShare(request, {
  configured,
  allowedOrigin,
  async authenticate(token) {
    if (!supabaseUrl || !publishableKey) return null;
    const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  async findGrant(objectId, recipientId) {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.from("share_grants").select("id,patient_id,recipient_id,object_id,expires_at,revoked_at").eq("object_id", objectId).eq("recipient_id", recipientId).maybeSingle();
    return error ? null : data;
  },
  async downloadObject(path) {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.storage.from("zoe-shares").download(path);
    return error || !data ? null : data.text();
  },
  async writeAudit(grantId, actorId) {
    if (!supabaseUrl || !serviceRoleKey) return false;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("share_access_audit").insert({ grant_id: grantId, actor_id: actorId, outcome: "downloaded" });
    return !error;
  }
}));
