export const SHARE_ENVELOPE_VERSION = 1 as const;

export interface ShareMetadata {
  patientId: string;
  recipientId: string;
  objectId: string;
  expiresAt: string;
}

export interface SharePayload {
  patientDisplayName: string;
  createdAt: string;
  records: Array<{
    id: string;
    kind: string;
    title: string;
    detail: string;
    recordedAt: string;
    source: string;
  }>;
}

export interface ShareEnvelope {
  version: typeof SHARE_ENVELOPE_VERSION;
  algorithm: "AES-256-GCM";
  keyId: string;
  metadata: ShareMetadata;
  iv: string;
  ciphertext: string;
}

export interface AuthorizedGrantMetadata extends ShareMetadata {
  grantId: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function shareAdditionalData(metadata: ShareMetadata, keyId: string): string {
  return JSON.stringify({
    version: SHARE_ENVELOPE_VERSION,
    keyId,
    patientId: metadata.patientId,
    recipientId: metadata.recipientId,
    objectId: metadata.objectId,
    expiresAt: metadata.expiresAt
  });
}

function metadataBytes(metadata: ShareMetadata, keyId: string): Uint8Array {
  return encoder.encode(shareAdditionalData(metadata, keyId));
}

export function validateMetadata(metadata: ShareMetadata, now = new Date()): void {
  if (!metadata.patientId || !metadata.recipientId || !metadata.objectId) throw new Error("Share metadata is incomplete.");
  const expiry = Date.parse(metadata.expiresAt);
  if (!Number.isFinite(expiry)) throw new Error("Share expiry is invalid.");
  if (expiry <= now.getTime()) throw new Error("Share has expired.");
}

export function assertEnvelopeMatchesGrant(envelope: ShareEnvelope, grant: AuthorizedGrantMetadata): void {
  const metadata = envelope.metadata;
  const envelopeExpiry = Date.parse(metadata.expiresAt);
  const grantExpiry = Date.parse(grant.expiresAt);
  if (
    metadata.patientId !== grant.patientId ||
    metadata.recipientId !== grant.recipientId ||
    metadata.objectId !== grant.objectId ||
    !Number.isFinite(envelopeExpiry) ||
    !Number.isFinite(grantExpiry) ||
    envelopeExpiry !== grantExpiry
  ) {
    throw new Error("Encrypted share metadata does not match the authorized grant.");
  }
}

export async function encryptShare(payload: SharePayload, metadata: ShareMetadata): Promise<{ envelope: ShareEnvelope; key: string }> {
  validateMetadata(metadata);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyId = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(rawKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(metadataBytes(metadata, keyId)), tagLength: 128 },
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return {
    envelope: {
      version: SHARE_ENVELOPE_VERSION,
      algorithm: "AES-256-GCM",
      keyId,
      metadata,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    },
    key: bytesToBase64(rawKey)
  };
}

export async function decryptShare(envelope: ShareEnvelope, encodedKey: string, expectedRecipientId: string): Promise<SharePayload> {
  if (envelope.version !== SHARE_ENVELOPE_VERSION || envelope.algorithm !== "AES-256-GCM") throw new Error("Unsupported share envelope.");
  if (!envelope.keyId) throw new Error("Share key identifier is missing.");
  validateMetadata(envelope.metadata);
  if (!expectedRecipientId) throw new Error("Expected recipient is required.");
  if (envelope.metadata.recipientId !== expectedRecipientId) throw new Error("This share belongs to another recipient.");
  const rawKey = base64ToBytes(encodedKey);
  if (rawKey.byteLength !== 32) throw new Error("Share key is invalid.");
  const iv = base64ToBytes(envelope.iv);
  if (iv.byteLength !== 12) throw new Error("Share IV is invalid.");
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(rawKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(metadataBytes(envelope.metadata, envelope.keyId)), tagLength: 128 },
    key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext))
  );
  const payload = JSON.parse(decoder.decode(plaintext)) as SharePayload;
  if (!Array.isArray(payload.records) || typeof payload.patientDisplayName !== "string") throw new Error("Share payload is invalid.");
  return payload;
}

export function encodeEnvelope(envelope: ShareEnvelope): string {
  return bytesToBase64(encoder.encode(JSON.stringify(envelope)));
}

export function decodeEnvelope(value: string): ShareEnvelope {
  const candidate = JSON.parse(decoder.decode(base64ToBytes(value))) as Partial<ShareEnvelope>;
  if (candidate.version !== SHARE_ENVELOPE_VERSION || candidate.algorithm !== "AES-256-GCM" || !candidate.keyId || !candidate.metadata || !candidate.iv || !candidate.ciphertext) {
    throw new Error("Share envelope is invalid.");
  }
  return candidate as ShareEnvelope;
}
