import type { PatientRecord } from "@zoe/records";

export interface Vault {
  mode: "sqlcipher" | "web-preview";
  loadRecords(): Promise<PatientRecord[]>;
  saveRecords(records: PatientRecord[]): Promise<void>;
  lock(): Promise<void>;
}
