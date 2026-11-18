import type { PatientRecord } from "@zoe/records";
import type { Vault, VaultOpenOptions } from "./vault.types";

export { VaultAccessError, type Vault, type VaultOpenOptions } from "./vault.types";

const WEB_KEY = "zoe.synthetic.records.v1";

export async function openVault(_userId: string, _options: VaultOpenOptions = {}): Promise<Vault> {
  const isNew = globalThis.localStorage?.getItem(WEB_KEY) === null;
  return {
    mode: "web-preview",
    isNew,
    protection: "preview",
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
