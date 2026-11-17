import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { PatientRecord } from "@zoe/records";
import type { Vault } from "./vault.types";

export type { Vault } from "./vault.types";

function assertHexKey(key: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Vault key format is invalid.");
}

async function getOrCreateVaultKey(userId: string): Promise<string> {
  const keyName = `zoe.vault.${userId}`;
  const authOptions: SecureStore.SecureStoreOptions = {
    requireAuthentication: true,
    authenticationPrompt: "Unlock this Zoe account vault",
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  };
  const existing = await SecureStore.getItemAsync(keyName, authOptions);
  if (existing) {
    assertHexKey(existing);
    return existing;
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  assertHexKey(key);
  await SecureStore.setItemAsync(keyName, key, authOptions);
  return key;
}

export async function openVault(userId: string): Promise<Vault> {
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(userId)) throw new Error("User vault namespace is invalid.");
  const key = await getOrCreateVaultKey(userId);
  const database = await SQLite.openDatabaseAsync(`zoe-${userId}.db`);
  try {
    await database.execAsync(`PRAGMA key = \"x'${key}'\";`);
    const cipher = await database.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version;");
    if (!cipher?.cipher_version) throw new Error("SQLCipher is unavailable. Zoe refused to open the vault.");
    await database.execAsync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY NOT NULL,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (error) {
    await database.closeAsync();
    throw error;
  }

  return {
    mode: "sqlcipher",
    async loadRecords() {
      const rows = await database.getAllAsync<{ body: string }>("SELECT body FROM records ORDER BY updated_at DESC");
      return rows.map((row) => JSON.parse(row.body) as PatientRecord);
    },
    async saveRecords(records) {
      await database.withTransactionAsync(async () => {
        await database.runAsync("DELETE FROM records");
        for (const record of records) {
          await database.runAsync("INSERT INTO records (id, body, updated_at) VALUES (?, ?, ?)", record.id, JSON.stringify(record), new Date().toISOString());
        }
      });
    },
    async lock() {
      await database.closeAsync();
    }
  };
}
