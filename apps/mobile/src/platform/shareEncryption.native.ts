import * as Crypto from "expo-crypto";
import ShareCrypto from "@zoe/share-crypto";
import {
  SHARE_ENVELOPE_VERSION,
  shareAdditionalData,
  validateMetadata,
  type ShareEnvelope,
  type ShareMetadata,
  type SharePayload
} from "@zoe/share-contract";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Android production encryption is performed by the Kotlin AES-GCM module. */
export async function encryptShareForPlatform(
  payload: SharePayload,
  metadata: ShareMetadata
): Promise<{ envelope: ShareEnvelope; key: string }> {
  validateMetadata(metadata);
  const key = bytesToBase64(await Crypto.getRandomBytesAsync(32));
  const keyId = bytesToBase64(await Crypto.getRandomBytesAsync(16));
  const encrypted = await ShareCrypto.encrypt(JSON.stringify(payload), key, shareAdditionalData(metadata, keyId));
  return {
    key,
    envelope: {
      version: SHARE_ENVELOPE_VERSION,
      algorithm: "AES-256-GCM",
      keyId,
      metadata,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext
    }
  };
}
