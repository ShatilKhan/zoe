import { describe, expect, it } from "vitest";
import { assertEnvelopeMatchesGrant, decodeEnvelope, decryptShare, encodeEnvelope, encryptShare, type ShareMetadata, type SharePayload } from "../src/index";

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

  it("binds every encrypted metadata field to the server-authorized grant", async () => {
    const encrypted = await encryptShare(payload, metadata);
    const grant = { grantId: "grant-1", ...metadata };
    expect(() => assertEnvelopeMatchesGrant(encrypted.envelope, grant)).not.toThrow();
    expect(() => assertEnvelopeMatchesGrant(encrypted.envelope, { ...grant, expiresAt: "2099-01-01T00:00:00Z" })).not.toThrow();
    for (const changed of [
      { ...grant, patientId: "other-patient" },
      { ...grant, recipientId: "other-recipient" },
      { ...grant, objectId: "other-object" },
      { ...grant, expiresAt: "2098-01-01T00:00:00.000Z" }
    ]) {
      expect(() => assertEnvelopeMatchesGrant(encrypted.envelope, changed)).toThrow("does not match");
    }
  });

  it("decrypts the fixed Android Kotlin AES-GCM interoperability vector", async () => {
    const vectorMetadata: ShareMetadata = { patientId: "patient-a", recipientId: "clinician-a", objectId: "object-a", expiresAt: "2099-01-01T00:00:00.000Z" };
    await expect(decryptShare({
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: "interop-key",
      metadata: vectorMetadata,
      iv: "ICEiIyQlJicoKSor",
      ciphertext: "qRjWERjxf2BuOCu9sXSVgJ4ogfmlukG9FZgYeiz+N2pV3oRw50BbrjbRTPEqbH68h06t+rgGD1P+UEkwfYMn7OBy/Tusp9Wsu1rHF4ttY0P5tUFh1JT0erxt+HFHYdjyqvyGQFKjAwslAL4mB/c="
    }, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "clinician-a")).resolves.toEqual({
      patientDisplayName: "Synthetic Patient",
      createdAt: "2026-11-18T00:00:00.000Z",
      records: []
    });
  });
});
