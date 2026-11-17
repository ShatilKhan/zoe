import { describe, expect, it } from "vitest";
import { decodeEnvelope, decryptShare, encodeEnvelope, encryptShare, type ShareMetadata, type SharePayload } from "../src/index";

const metadata: ShareMetadata = {
  patientId: "synthetic-patient",
  recipientId: "synthetic-clinician",
  objectId: "object-1",
  expiresAt: "2099-01-01T00:00:00.000Z"
};

const payload: SharePayload = {
  patientDisplayName: "Synthetic Patient",
  createdAt: "2026-11-18T00:00:00.000Z",
  records: [{ id: "r1", kind: "allergy", title: "Synthetic allergy", detail: "Demo only", recordedAt: "2026-11-18T00:00:00.000Z", source: "patient-reported" }]
};

describe("encrypted share contract", () => {
  it("round-trips selected records and transport encoding", async () => {
    const encrypted = await encryptShare(payload, metadata);
    const decoded = decodeEnvelope(encodeEnvelope(encrypted.envelope));
    await expect(decryptShare(decoded, encrypted.key, "synthetic-clinician")).resolves.toEqual(payload);
  });

  it("binds recipient metadata as authenticated data", async () => {
    const encrypted = await encryptShare(payload, metadata);
    const tampered = { ...encrypted.envelope, metadata: { ...metadata, recipientId: "attacker" } };
    await expect(decryptShare(tampered, encrypted.key, "attacker")).rejects.toThrow();
  });

  it("rejects a wrong recipient before rendering", async () => {
    const encrypted = await encryptShare(payload, metadata);
    await expect(decryptShare(encrypted.envelope, encrypted.key, "other-clinician")).rejects.toThrow("another recipient");
  });

  it("never decrypts without an explicit recipient binding", async () => {
    const encrypted = await encryptShare(payload, metadata);
    await expect(decryptShare(encrypted.envelope, encrypted.key, "")).rejects.toThrow("required");
  });

  it("rejects a malformed IV before decryption", async () => {
    const encrypted = await encryptShare(payload, metadata);
    await expect(decryptShare({ ...encrypted.envelope, iv: "AA==" }, encrypted.key, metadata.recipientId)).rejects.toThrow("IV is invalid");
  });

  it("authenticates key identifiers and ciphertext", async () => {
    const encrypted = await encryptShare(payload, metadata);
    await expect(decryptShare({ ...encrypted.envelope, keyId: "another-key" }, encrypted.key, metadata.recipientId)).rejects.toThrow();
    const bytes = Uint8Array.from(atob(encrypted.envelope.ciphertext), (value) => value.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tamperedCiphertext = btoa(String.fromCharCode(...bytes));
    await expect(decryptShare({ ...encrypted.envelope, ciphertext: tamperedCiphertext }, encrypted.key, metadata.recipientId)).rejects.toThrow();
  });
});
