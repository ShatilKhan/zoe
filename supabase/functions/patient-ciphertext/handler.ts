import { isOwner, isValidObjectId, isValidRevision, secureResponseHeaders } from "./policy.ts";

export interface PatientCiphertextDependencies {
  configured: boolean;
  allowedOrigin: string;
  // Verify a Clerk JWT and return the subject (sub claim) or null.
  verifyClerkToken(token: string): Promise<string | null>;
  // Fetch a wrapping secret from Infisical by name. Returns the secret value or null.
  fetchWrappingSecret(secretName: string): Promise<string | null>;
  // Store ciphertext metadata. Returns true on success.
  storeMetadata(row: {
    owner_subject: string;
    object_id: string;
    revision: number;
    storage_path: string;
    wrapped_key: string;
    key_version: string;
    size_bytes: number;
    content_type: string;
  }): Promise<boolean>;
  // Retrieve ciphertext metadata for an owner+object. Returns row or null.
  getMetadata(ownerSubject: string, objectId: string, revision: number): Promise<{
    id: string;
    owner_subject: string;
    object_id: string;
    revision: number;
    storage_path: string;
    wrapped_key: string;
    key_version: string;
    size_bytes: number;
  } | null>;
  // Delete (soft) ciphertext metadata. Returns true on success.
  deleteMetadata(ownerSubject: string, objectId: string, revision: number): Promise<boolean>;
  // Upload encrypted bytes to Supabase Storage. Returns true on success.
  uploadBytes(path: string, bytes: Uint8Array): Promise<boolean>;
  // Download encrypted bytes from Supabase Storage. Returns bytes or null.
  downloadBytes(path: string): Promise<Uint8Array | null>;
  now?: () => number;
}

// Simple AES-GCM wrap/unwrap using Web Crypto API.
// In production, use a proper KDF (HKDF) to derive the wrapping key from the Infisical secret.
async function deriveWrappingKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("zoe-wrap-salt-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapKey(fileKey: Uint8Array, wrappingSecret: string): Promise<string> {
  const wrappingKey = await deriveWrappingKey(wrappingSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, fileKey);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function unwrapKey(wrappedKey: string, wrappingSecret: string): Promise<Uint8Array | null> {
  try {
    const combined = Uint8Array.from(atob(wrappedKey), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const wrappingKey = await deriveWrappingKey(wrappingSecret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrappingKey, ciphertext);
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

function json(request: Request, allowedOrigin: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: secureResponseHeaders(request.headers.get("Origin"), allowedOrigin) });
}

export async function handlePatientCiphertext(request: Request, dependencies: PatientCiphertextDependencies): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== dependencies.allowedOrigin) return json(request, dependencies.allowedOrigin, 403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: secureResponseHeaders(origin, dependencies.allowedOrigin) });
  if (request.method !== "POST") return json(request, dependencies.allowedOrigin, 405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, dependencies.allowedOrigin, 401, { error: "authentication_required" });
  if (!dependencies.configured) return json(request, dependencies.allowedOrigin, 500, { error: "server_configuration_error" });

  let body: { action?: unknown; objectId?: unknown; revision?: unknown; wrappedKey?: unknown; keyVersion?: unknown; sizeBytes?: unknown; contentType?: unknown; bytes?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json(request, dependencies.allowedOrigin, 400, { error: "invalid_json" });
  }

  const actorSubject = await dependencies.verifyClerkToken(authorization.slice("Bearer ".length));
  if (!actorSubject) return json(request, dependencies.allowedOrigin, 401, { error: "invalid_session" });

  const action = body.action;
  if (action === "wrap") {
    if (!isValidObjectId(body.objectId)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_object_id" });
    if (!isValidRevision(body.revision)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_revision" });
    if (typeof body.wrappedKey !== "string") return json(request, dependencies.allowedOrigin, 400, { error: "invalid_wrapped_key" });
    if (typeof body.keyVersion !== "string") return json(request, dependencies.allowedOrigin, 400, { error: "invalid_key_version" });
    if (typeof body.sizeBytes !== "number" || body.sizeBytes < 0 || body.sizeBytes > 10485760) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_size" });

    // Fetch wrapping secret from Infisical
    const wrappingSecret = await dependencies.fetchWrappingSecret(body.keyVersion);
    if (!wrappingSecret) return json(request, dependencies.allowedOrigin, 500, { error: "wrapping_secret_unavailable" });

    // Unwrap the client-provided file key (client sends wrapped with a temp key, or raw key for first upload)
    // For simplicity in synthetic MVP: client sends raw file key, server wraps it
    let fileKey: Uint8Array;
    try {
      fileKey = Uint8Array.from(atob(body.wrappedKey as string), (c) => c.charCodeAt(0));
    } catch {
      return json(request, dependencies.allowedOrigin, 400, { error: "invalid_key_encoding" });
    }

    const wrappedKey = await wrapKey(fileKey, wrappingSecret);
    const storagePath = `${actorSubject}/${body.objectId}/rev-${body.revision}.bin`;

    // Upload bytes if provided
    if (body.bytes) {
      try {
        const bytes = Uint8Array.from(atob(body.bytes as string), (c) => c.charCodeAt(0));
        const uploaded = await dependencies.uploadBytes(storagePath, bytes);
        if (!uploaded) return json(request, dependencies.allowedOrigin, 500, { error: "upload_failed" });
      } catch {
        return json(request, dependencies.allowedOrigin, 400, { error: "invalid_bytes" });
      }
    }

    const stored = await dependencies.storeMetadata({
      owner_subject: actorSubject,
      object_id: body.objectId as string,
      revision: body.revision as number,
      storage_path: storagePath,
      wrapped_key: wrappedKey,
      key_version: body.keyVersion as string,
      size_bytes: body.sizeBytes as number,
      content_type: (body.contentType as string) ?? "application/octet-stream",
    });
    if (!stored) return json(request, dependencies.allowedOrigin, 500, { error: "metadata_store_failed" });

    return json(request, dependencies.allowedOrigin, 200, { objectId: body.objectId, revision: body.revision, storagePath, wrappedKey, keyVersion: body.keyVersion });
  }

  if (action === "unwrap") {
    if (!isValidObjectId(body.objectId)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_object_id" });
    if (!isValidRevision(body.revision)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_revision" });

    const metadata = await dependencies.getMetadata(actorSubject, body.objectId as string, body.revision as number);
    if (!metadata) return json(request, dependencies.allowedOrigin, 404, { error: "object_not_found" });
    if (!isOwner(metadata.owner_subject, actorSubject)) return json(request, dependencies.allowedOrigin, 403, { error: "access_denied" });

    const wrappingSecret = await dependencies.fetchWrappingSecret(metadata.key_version);
    if (!wrappingSecret) return json(request, dependencies.allowedOrigin, 500, { error: "wrapping_secret_unavailable" });

    const fileKey = await unwrapKey(metadata.wrapped_key, wrappingSecret);
    if (!fileKey) return json(request, dependencies.allowedOrigin, 500, { error: "unwrap_failed" });

    const bytes = await dependencies.downloadBytes(metadata.storage_path);
    if (!bytes) return json(request, dependencies.allowedOrigin, 404, { error: "object_not_found" });

    return json(request, dependencies.allowedOrigin, 200, {
      objectId: metadata.object_id,
      revision: metadata.revision,
      fileKey: btoa(String.fromCharCode(...fileKey)),
      bytes: btoa(String.fromCharCode(...bytes)),
      sizeBytes: metadata.size_bytes,
    });
  }

  if (action === "delete") {
    if (!isValidObjectId(body.objectId)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_object_id" });
    if (!isValidRevision(body.revision)) return json(request, dependencies.allowedOrigin, 400, { error: "invalid_revision" });

    const deleted = await dependencies.deleteMetadata(actorSubject, body.objectId as string, body.revision as number);
    if (!deleted) return json(request, dependencies.allowedOrigin, 404, { error: "object_not_found" });
    return json(request, dependencies.allowedOrigin, 200, { deleted: true });
  }

  return json(request, dependencies.allowedOrigin, 400, { error: "invalid_action" });
}