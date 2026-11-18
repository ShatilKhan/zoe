import type { PatientRecord } from "@zoe/records";

export function recordsForOpenedVault(saved: PatientRecord[], syntheticPreview: boolean, isNewVault: boolean, syntheticSeed: PatientRecord[]): PatientRecord[] {
  if (saved.length > 0) return saved;
  return syntheticPreview && isNewVault ? syntheticSeed : [];
}
