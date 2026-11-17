import type { PatientRecord } from "@zoe/records";
import type { Vault } from "./vault.types";

export type { Vault } from "./vault.types";

const WEB_KEY = "zoe.synthetic.records.v1";

export async function openVault(_userId: string): Promise<Vault> {
  return {
    mode: "web-preview",
    async loadRecords() {
      const raw = globalThis.localStorage?.getItem(WEB_KEY);
      return raw ? (JSON.parse(raw) as PatientRecord[]) : [];
    },
    async saveRecords(records) {
      globalThis.localStorage?.setItem(WEB_KEY, JSON.stringify(records));
    },
    async lock() {}
  };
}
