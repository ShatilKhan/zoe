import { createClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import { encodeEnvelope } from "@zoe/share-contract";
import type { PatientRecord } from "@zoe/records";
import { encryptShareForPlatform } from "./shareEncryption";

const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://ixwpotnpnlotjecmjbnb.supabase.co";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CloudSession {
  userId: string;
  accessToken: string;
  email: string;
}

export interface CloudGrant {
  id: string;
  recipientId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ResolvedRecipient {
  userId: string;
  displayName: string;
  organization: string;
}

export const cloudAuthAvailable = Boolean(publishableKey);

function client() {
  if (!publishableKey) throw new Error("Supabase publishable key is not configured.");
  return createClient(projectUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function authenticatedClient(session: CloudSession) {
  return createClient(projectUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.accessToken}` } }
  });
}

export async function requestEmailOtp(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailOtp(email: string, token: string): Promise<CloudSession> {
  const { data, error } = await client().auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.session || !data.user || !data.user.email) throw error ?? new Error("Supabase did not return an authenticated session.");
  return { userId: data.user.id, accessToken: data.session.access_token, email: data.user.email };
}

export async function uploadEncryptedShare(session: CloudSession, recipientId: string, records: PatientRecord[]): Promise<string> {
  if (!uuidPattern.test(session.userId) || !uuidPattern.test(recipientId)) throw new Error("Patient and recipient must be authenticated Supabase account IDs.");
  if (records.length === 0) throw new Error("Select at least one record.");
  const objectId = Crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const encrypted = await encryptShareForPlatform(
    {
      patientDisplayName: session.email,
      createdAt: new Date().toISOString(),
      records: records.map(({ id, kind, title, detail, recordedAt, source }) => ({ id, kind, title, detail, recordedAt, source }))
    },
    { patientId: session.userId, recipientId, objectId, expiresAt }
  );
  const authenticated = authenticatedClient(session);
  const path = `${session.userId}/${objectId}.bin`;
  const body = new Blob([encodeEnvelope(encrypted.envelope)], { type: "application/octet-stream" });
  const { error: uploadError } = await authenticated.storage.from("zoe-shares").upload(path, body, { contentType: "application/octet-stream", upsert: false });
  if (uploadError) throw uploadError;
  const { error: grantError } = await authenticated.from("share_grants").insert({ patient_id: session.userId, recipient_id: recipientId, object_id: objectId, expires_at: expiresAt });
  if (grantError) {
    await authenticated.storage.from("zoe-shares").remove([path]);
    throw grantError;
  }
  const viewerOrigin = process.env.EXPO_PUBLIC_CLINICIAN_VIEWER_URL || "https://zoe-clinician-preview.pages.dev";
  return `${viewerOrigin}/?objectId=${encodeURIComponent(objectId)}#${encodeURIComponent(encrypted.key)}`;
}

export async function resolveShareRecipient(session: CloudSession, recipientId: string): Promise<ResolvedRecipient> {
  if (!uuidPattern.test(recipientId)) throw new Error("Enter the clinician's Supabase account ID.");
  const { data, error } = await authenticatedClient(session)
    .from("share_recipients")
    .select("user_id,display_name,organization")
    .eq("user_id", recipientId)
    .eq("accepting_shares", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No accepting clinician profile matched that account ID.");
  return { userId: data.user_id, displayName: data.display_name, organization: data.organization };
}

export async function listShareGrants(session: CloudSession): Promise<CloudGrant[]> {
  const { data, error } = await authenticatedClient(session)
    .from("share_grants")
    .select("id,recipient_id,expires_at,revoked_at")
    .eq("patient_id", session.userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((grant) => ({ id: grant.id, recipientId: grant.recipient_id, expiresAt: grant.expires_at, revokedAt: grant.revoked_at }));
}

export async function revokeShareGrant(session: CloudSession, grantId: string): Promise<void> {
  if (!uuidPattern.test(grantId)) throw new Error("Grant ID is invalid.");
  const { data, error } = await authenticatedClient(session)
    .from("share_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("patient_id", session.userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Grant was already revoked or is unavailable.");
}
