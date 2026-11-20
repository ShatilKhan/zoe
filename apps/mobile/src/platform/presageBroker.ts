/**
 * SmartSpectra QA broker client.
 * Fetches a runtime Presage API key from the Edge Function at
 * https://ixwpotnpnlotjecmjbnb.supabase.co/functions/v1/presage-qa-broker.
 * Returns an in-memory key only; never writes to disk or logs.
 * Synthetic QA only — never used as production release path.
 */

export interface BrokerConfig {
  brokerUrl: string;
  clerkToken: string;
}

export interface BrokerResponse {
  key: string;
  expiresAt: string;
}

const BROKER_URL = "https://ixwpotnpnlotjecmjbnb.supabase.co/functions/v1/presage-qa-broker";

let cachedKey: { key: string; expiresAt: number } | null = null;

/**
 * Fetch a runtime Presage key from the QA broker Edge Function.
 * Caches for up to 1 hour (or until expiresAt).
 */
export async function fetchPresageKeyFromBroker(clerkToken: string): Promise<string> {
  const now = Date.now();

  // Return cached key if still valid (with 5-minute safety margin)
  if (cachedKey && cachedKey.expiresAt > now + 300000) {
    return cachedKey.key;
  }

  const response = await fetch(BROKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clerkToken}`,
    },
    body: JSON.stringify({ appVersion: "1.0.0" }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Broker returned ${response.status}`);
  }

  const data: BrokerResponse = await response.json();

  cachedKey = {
    key: data.key,
    expiresAt: new Date(data.expiresAt).getTime(),
  };

  return data.key;
}

/**
 * Clear the cached key (e.g., on sign-out or when capture stops).
 */
export function clearPresageKeyCache(): void {
  cachedKey = null;
}

/**
 * Check if a broker key is currently cached and valid.
 */
export function hasBrokerKey(): boolean {
  const now = Date.now();
  return cachedKey != null && cachedKey.expiresAt > now + 300000;
}