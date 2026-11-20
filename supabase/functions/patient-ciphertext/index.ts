import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { handlePatientCiphertext } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const infisicalToken = Deno.env.get("INFISICAL_SERVICE_TOKEN");
const infisicalProjectId = Deno.env.get("INFISICAL_PROJECT_ID");
const infisicalEnv = Deno.env.get("INFISICAL_ENV") ?? "dev";
const configured = Boolean(supabaseUrl && serviceRoleKey && infisicalToken && infisicalProjectId);

// Clerk JWT verification using JWKS
const CLERK_FRONTEND_API = "https://neutral-insect-8035.clerk.accounts.dev";
let jwksCache: { keys: any[]; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<any[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 3600000) return jwksCache.keys;
  const response = await fetch(`${CLERK_FRONTEND_API}/.well-known/jwks.json`);
  if (!response.ok) return [];
  const data = await response.json();
  jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    // Get the signing key
    const keys = await fetchJwks();
    const key = keys.find((k: any) => k.kid === header.kid);
    if (!key) return null;
    // Import the key
    const jwk = { kty: key.kty, n: key.n, e: key.e, alg: key.alg, use: key.use };
    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    // Verify signature
    const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const dataBytes = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signatureBytes, dataBytes);
    if (!valid) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// Fetch wrapping secret from Infisical
async function fetchWrappingSecret(secretName: string): Promise<string | null> {
  if (!infisicalToken || !infisicalProjectId) return null;
  try {
    const response = await fetch(
      `https://app.infisical.com/api/v3/secrets/raw/${secretName}?environment=${infisicalEnv}&projectId=${infisicalProjectId}&viewSecretValue=true`,
      {
        headers: {
          "Authorization": `Bearer ${infisicalToken}`,
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.secret?.secretValue ?? null;
  } catch {
    return null;
  }
}

Deno.serve((request: Request) => handlePatientCiphertext(request, {
  configured,
  allowedOrigin,
  async verifyClerkToken(token) {
    return verifyClerkToken(token);
  },
  async fetchWrappingSecret(secretName) {
    return fetchWrappingSecret(secretName);
  },
  async storeMetadata(row) {
    if (!supabaseUrl || !serviceRoleKey) return false;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("patient_ciphertext_objects").insert(row);
    return !error;
  },
  async getMetadata(ownerSubject, objectId, revision) {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.from("patient_ciphertext_objects").select("*").eq("owner_subject", ownerSubject).eq("object_id", objectId).eq("revision", revision).is("deleted_at", null).maybeSingle();
    if (error || !data) return null;
    return data as any;
  },
  async deleteMetadata(ownerSubject, objectId, revision) {
    if (!supabaseUrl || !serviceRoleKey) return false;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("patient_ciphertext_objects").update({ deleted_at: new Date().toISOString() }).eq("owner_subject", ownerSubject).eq("object_id", objectId).eq("revision", revision);
    return !error;
  },
  async uploadBytes(path, bytes) {
    if (!supabaseUrl || !serviceRoleKey) return false;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.storage.from("zoe-patient-ciphertext").upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
    return !error;
  },
  async downloadBytes(path) {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.storage.from("zoe-patient-ciphertext").download(path);
    if (error || !data) return null;
    const buffer = await data.arrayBuffer();
    return new Uint8Array(buffer);
  },
}));