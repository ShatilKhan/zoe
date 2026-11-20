export interface PresageQaBrokerDependencies {
  configured: boolean;
  allowedOrigin: string;
  verifyClerkToken(token: string): Promise<string | null>;
  fetchPresageKey(): Promise<string | null>;
  isAllowedAccount(subject: string): Promise<{ allowed: boolean; allowedUntil: string | null; maxRequestsPerHour: number }>;
  countRecentRequests(subject: string, sinceMs: number): Promise<number>;
  recordRequest(subject: string, outcome: string): Promise<boolean>;
  now?: () => number;
}

function json(request: Request, allowedOrigin: string, status: number, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };
  const origin = request.headers.get("Origin");
  if (origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handlePresageQaBroker(request: Request, dependencies: PresageQaBrokerDependencies): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== dependencies.allowedOrigin) return json(request, dependencies.allowedOrigin, 403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": dependencies.allowedOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
  if (request.method !== "POST") return json(request, dependencies.allowedOrigin, 405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, dependencies.allowedOrigin, 401, { error: "authentication_required" });
  if (!dependencies.configured) return json(request, dependencies.allowedOrigin, 500, { error: "server_configuration_error" });

  const actorSubject = await dependencies.verifyClerkToken(authorization.slice("Bearer ".length));
  if (!actorSubject) return json(request, dependencies.allowedOrigin, 401, { error: "invalid_session" });

  const now = (dependencies.now ?? Date.now)();
  // Allow any authenticated user (no allowlist restriction for hackathon demo)
  const maxRequestsPerHour = 20;

  // Rate limit check
  const oneHourAgo = now - 3600000;
  const recentCount = await dependencies.countRecentRequests(actorSubject, oneHourAgo);
  if (recentCount >= maxRequestsPerHour) {
    await dependencies.recordRequest(actorSubject, "rate_limited");
    return json(request, dependencies.allowedOrigin, 429, { error: "rate_limited" });
  }

  // Fetch key from Infisical
  const key = await dependencies.fetchPresageKey();
  if (!key) {
    await dependencies.recordRequest(actorSubject, "not_allowed");
    return json(request, dependencies.allowedOrigin, 500, { error: "key_unavailable" });
  }

  await dependencies.recordRequest(actorSubject, "allowed");
  return json(request, dependencies.allowedOrigin, 200, { key, expiresAt: new Date(now + 3600000).toISOString() });
}