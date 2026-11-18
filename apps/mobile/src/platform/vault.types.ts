import type { PatientRecord } from "@zoe/records";

export interface Vault {
  mode: "sqlcipher" | "web-preview";
  isNew: boolean;
  protection: "passphrase" | "biometric" | "preview";
  migrateToPassphrase?: (passphrase: string) => Promise<Vault>;
  loadRecords(): Promise<PatientRecord[]>;
  saveRecords(records: PatientRecord[]): Promise<void>;
  lock(): Promise<void>;
}

export interface VaultOpenOptions {
  passphrase?: string;
  setupPassphrase?: boolean;
}

export type VaultAccessReason = "setup_required" | "passphrase_required" | "key_lost" | "biometric_unavailable" | "invalid_passphrase";

export class VaultAccessError extends Error {
  constructor(public readonly reason: VaultAccessReason, message: string) {
    super(message);
    this.name = "VaultAccessError";
  }
}
