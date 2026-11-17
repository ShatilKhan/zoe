import { encryptShare, type ShareMetadata, type SharePayload } from "@zoe/share-contract";

export function encryptShareForPlatform(payload: SharePayload, metadata: ShareMetadata) {
  return encryptShare(payload, metadata);
}
