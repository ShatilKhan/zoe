import { createClient } from "@supabase/supabase-js";

const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://ixwpotnpnlotjecmjbnb.supabase.co";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export interface CloudSession {
  userId: string;
  accessToken: string;
  email: string;
}

export const cloudAuthAvailable = Boolean(publishableKey);

function client() {
  if (!publishableKey) throw new Error("Supabase publishable key is not configured.");
  return createClient(projectUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
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
