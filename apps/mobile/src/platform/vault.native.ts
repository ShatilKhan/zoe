import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import ShareCrypto from "@zoe/share-crypto";
import type { PatientRecord } from "@zoe/records";
import { VaultAccessError, type Vault, type VaultOpenOptions } from "./vault.types";
import { VAULT_CANARY, VAULT_KDF_VERSION, parseBundle, parseMetadata, validateNewPassphrase, vaultNames, type PassphraseBundle, type VaultMetadata } from "./vaultPolicy";

export { VaultAccessError, type Vault, type VaultOpenOptions } from "./vault.types";

const setupInFlight = new Map<string, Promise<Vault>>();
const deviceOnly: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const biometric: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: "Unlock this Zoe account vault",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

function assertHexKey(key: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Vault key format is invalid.");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function derivePassphraseKey(userId: string, passphrase: string, bundle: PassphraseBundle): Promise<string> {
  const key = await ShareCrypto.deriveVaultKey(passphrase.normalize("NFKC"), bundle.deviceSecret, bundle.salt, vaultNames(userId).kdfNamespace);
  assertHexKey(key);
  return key;
}

export function sqliteDatabaseFileUri(directory: string, databaseName: string): string {
  if (!databaseName || databaseName.includes("/") || databaseName.includes("\\")) throw new Error("SQLite database name is invalid.");
  const withoutTrailingSlash = directory.replace(/\/+$/, "");
  if (!withoutTrailingSlash) throw new Error("SQLite database directory is unavailable.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutTrailingSlash) && !withoutTrailingSlash.startsWith("file://")) {
    throw new Error("SQLite database directory must be a local file path.");
  }
  const fileDirectory = withoutTrailingSlash.startsWith("file://")
    ? withoutTrailingSlash
    : `file://${withoutTrailingSlash.startsWith("/") ? "" : "/"}${withoutTrailingSlash}`;
  return `${fileDirectory}/${databaseName}`;
}

function databaseExists(databaseName: string): boolean {
  return new File(sqliteDatabaseFileUri(SQLite.defaultDatabaseDirectory, databaseName)).exists;
}

async function openEncryptedDatabase(databaseName: string, key: string, allowInitialize: boolean): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(databaseName);
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'";`);
    const cipher = await database.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version;");
    if (!cipher?.cipher_version) throw new Error("SQLCipher is unavailable. Zoe refused to open the vault.");
    const canaryTable = await database.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_canary'");
    if (canaryTable) {
      const canary = await database.getFirstAsync<{ value: string }>("SELECT value FROM vault_canary WHERE id = 1");
      if (canary?.value !== VAULT_CANARY) throw new Error("Vault canary validation failed.");
    } else if (!allowInitialize) {
      throw new Error("Vault canary is missing. Zoe refused to modify this database.");
    } else {
      await database.execAsync(`
        CREATE TABLE vault_canary (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
        INSERT INTO vault_canary (id, value) VALUES (1, '${VAULT_CANARY}');
      `);
    }
    await database.execAsync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY NOT NULL,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

function asVault(database: SQLite.SQLiteDatabase, isNew = false, protection: Vault["protection"] = "passphrase", migrateToPassphrase?: (passphrase: string) => Promise<Vault>): Vault {
  return {
    mode: "sqlcipher",
    isNew,
    protection,
    ...(migrateToPassphrase ? { migrateToPassphrase } : {}),
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
    async lock() { await database.closeAsync(); }
  };
}

async function createPassphraseBundle(userId: string): Promise<PassphraseBundle> {
  return {
    version: VAULT_KDF_VERSION,
    userId,
    mode: "passphrase",
    salt: bytesToBase64(await Crypto.getRandomBytesAsync(16)),
    deviceSecret: bytesToBase64(await Crypto.getRandomBytesAsync(32))
  };
}

async function finalizeMigration(userId: string, database: SQLite.SQLiteDatabase, passphrase: string, bundle: PassphraseBundle): Promise<Vault> {
  const names = vaultNames(userId);
  const newKey = await derivePassphraseKey(userId, passphrase, bundle);
  await database.execAsync(`PRAGMA rekey = "x'${newKey}'";`);
  await database.closeAsync();
  const reopened = await openEncryptedDatabase(names.database, newKey, false);
  return persistCompletedMigration(userId, reopened, bundle);
}

async function persistCompletedMigration(userId: string, database: SQLite.SQLiteDatabase, bundle: PassphraseBundle): Promise<Vault> {
  const names = vaultNames(userId);
  const metadata: VaultMetadata = { version: VAULT_KDF_VERSION, userId, mode: "passphrase", salt: bundle.salt, initialized: true };
  try {
    await SecureStore.setItemAsync(names.metadata, JSON.stringify(metadata), deviceOnly);
  } catch {
    try { await database.closeAsync(); } catch { /* Best-effort handle cleanup; migration marker remains authoritative. */ }
    throw new VaultAccessError("passphrase_required", "The vault was rekeyed, but migration finalization was interrupted. Enter the same passphrase to finish without rekeying again.");
  }
  return asVault(database);
}

async function beginBiometricMigration(userId: string, database: SQLite.SQLiteDatabase, passphrase: string): Promise<Vault> {
  const strengthError = validateNewPassphrase(passphrase, userId);
  if (strengthError) throw new VaultAccessError("invalid_passphrase", strengthError);
  const names = vaultNames(userId);
  const currentMetadataRaw = await SecureStore.getItemAsync(names.metadata, deviceOnly);
  const existingBundle = await SecureStore.getItemAsync(names.passphraseBundle, deviceOnly);
  if (currentMetadataRaw) {
    let currentMetadata: VaultMetadata;
    try { currentMetadata = parseMetadata(currentMetadataRaw, userId); }
    catch { throw new VaultAccessError("key_lost", "Vault migration metadata is invalid. Zoe refused to replace it."); }
    if (currentMetadata.mode === "migration") return resumeMigration(userId, passphrase, currentMetadata, existingBundle);
    if (currentMetadata.mode === "passphrase") return openExistingPassphraseVault(userId, passphrase, currentMetadataRaw, existingBundle);
  }
  let bundle: PassphraseBundle;
  if (existingBundle) {
    try { bundle = parseBundle(existingBundle, userId); }
    catch { throw new VaultAccessError("key_lost", "Existing migration key material is invalid. Zoe refused to replace it."); }
  } else {
    bundle = await createPassphraseBundle(userId);
    await SecureStore.setItemAsync(names.passphraseBundle, JSON.stringify(bundle), deviceOnly);
  }
  const migration: VaultMetadata = { version: VAULT_KDF_VERSION, userId, mode: "migration", salt: bundle.salt, initialized: true };
  await SecureStore.setItemAsync(names.metadata, JSON.stringify(migration), deviceOnly);
  return finalizeMigration(userId, database, passphrase, bundle);
}

async function openExistingPassphraseVault(userId: string, passphrase: string, rawMetadata: string, rawBundle: string | null): Promise<Vault> {
  const names = vaultNames(userId);
  const metadata = parseMetadata(rawMetadata, userId);
  if (metadata.mode !== "passphrase") throw new Error("Vault protection mode is not passphrase.");
  if (!rawBundle) throw new VaultAccessError("key_lost", "This vault's device-bound key is missing. The encrypted data cannot be recovered on this device.");
  let bundle: PassphraseBundle;
  try { bundle = parseBundle(rawBundle, userId); }
  catch { throw new VaultAccessError("key_lost", "Vault device-key metadata is invalid. Zoe refused to derive or replace the key."); }
  if (bundle.salt !== metadata.salt) throw new VaultAccessError("key_lost", "Vault salt or KDF metadata changed. Zoe refused to derive a replacement key.");
  try {
    return asVault(await openEncryptedDatabase(names.database, await derivePassphraseKey(userId, passphrase, bundle), false));
  } catch {
    throw new VaultAccessError("invalid_passphrase", "The passphrase is incorrect, or this vault's encrypted database was copied or changed.");
  }
}

async function openLegacyBiometricVault(userId: string, rawMetadata: string | null): Promise<Vault> {
  const names = vaultNames(userId);
  let key: string | null;
  try {
    key = await SecureStore.getItemAsync(names.legacyBiometricKey, biometric);
  } catch {
    throw new VaultAccessError("biometric_unavailable", "The original biometric key is unavailable or invalidated. Zoe will not create a replacement vault.");
  }
  if (!key) throw new VaultAccessError("key_lost", "The original biometric key is missing. Zoe will not overwrite or regenerate it.");
  assertHexKey(key);
  try {
    const database = await openEncryptedDatabase(names.database, key, rawMetadata === null);
    if (!rawMetadata) {
      const metadata: VaultMetadata = { version: VAULT_KDF_VERSION, userId, mode: "biometric", initialized: true };
      await SecureStore.setItemAsync(names.metadata, JSON.stringify(metadata), deviceOnly);
    }
    return asVault(database, false, "biometric", (passphrase) => beginBiometricMigration(userId, database, passphrase));
  } catch {
    throw new VaultAccessError("key_lost", "The biometric key did not open the existing vault. No data or key was replaced.");
  }
}

async function setupPassphraseVault(userId: string, passphrase: string): Promise<Vault> {
  const strengthError = validateNewPassphrase(passphrase, userId);
  if (strengthError) throw new VaultAccessError("invalid_passphrase", strengthError);
  const names = vaultNames(userId);
  const rawMetadata = await SecureStore.getItemAsync(names.metadata, deviceOnly);
  if (rawMetadata) throw new Error("Vault setup is already complete.");
  let rawBundle = await SecureStore.getItemAsync(names.passphraseBundle, deviceOnly);
  const resumingInterruptedSetup = rawBundle !== null;
  const existedBeforeSetup = databaseExists(names.database);
  if (existedBeforeSetup && !rawBundle) return openLegacyBiometricVault(userId, null);
  if (!rawBundle) {
    const bundle = await createPassphraseBundle(userId);
    rawBundle = JSON.stringify(bundle);
    await SecureStore.setItemAsync(names.passphraseBundle, rawBundle, deviceOnly);
  }
  let bundle: PassphraseBundle;
  try { bundle = parseBundle(rawBundle, userId); }
  catch { throw new VaultAccessError("key_lost", "Vault device-key metadata is invalid. Zoe refused to derive or replace the key."); }
  let database: SQLite.SQLiteDatabase;
  try {
    database = await openEncryptedDatabase(names.database, await derivePassphraseKey(userId, passphrase, bundle), !existedBeforeSetup);
  } catch {
    throw new VaultAccessError("invalid_passphrase", "The passphrase did not open the existing vault. Zoe made no database or key changes.");
  }
  const metadata: VaultMetadata = { version: VAULT_KDF_VERSION, userId, mode: "passphrase", salt: bundle.salt, initialized: true };
  try {
    await SecureStore.setItemAsync(names.metadata, JSON.stringify(metadata), deviceOnly);
  } catch {
    await database.closeAsync();
    throw new VaultAccessError("passphrase_required", "Vault setup was interrupted after database verification. Enter the same passphrase to finish it.");
  }
  return asVault(database, !existedBeforeSetup || resumingInterruptedSetup);
}

async function resumeMigration(userId: string, passphrase: string, metadata: VaultMetadata, rawBundle: string | null): Promise<Vault> {
  if (!rawBundle) throw new VaultAccessError("key_lost", "Migration key material is missing. Zoe will not create a replacement.");
  let bundle: PassphraseBundle;
  try { bundle = parseBundle(rawBundle, userId); }
  catch { throw new VaultAccessError("key_lost", "Migration key material is invalid. Zoe will not replace it."); }
  if (bundle.salt !== metadata.salt) throw new VaultAccessError("key_lost", "Migration salt changed. Zoe refused to continue.");
  const names = vaultNames(userId);
  const newKey = await derivePassphraseKey(userId, passphrase, bundle);
  let alreadyRekeyed: SQLite.SQLiteDatabase | null = null;
  try {
    alreadyRekeyed = await openEncryptedDatabase(names.database, newKey, false);
  } catch { /* The database may still require the legacy biometric key. */ }
  if (alreadyRekeyed) return persistCompletedMigration(userId, alreadyRekeyed, bundle);

  let legacyKey: string | null;
  try { legacyKey = await SecureStore.getItemAsync(names.legacyBiometricKey, biometric); }
  catch { throw new VaultAccessError("biometric_unavailable", "Migration was interrupted and the old biometric key is unavailable."); }
  if (!legacyKey) throw new VaultAccessError("key_lost", "Migration was interrupted and the old biometric key is missing.");
  assertHexKey(legacyKey);
  let oldDatabase: SQLite.SQLiteDatabase;
  try { oldDatabase = await openEncryptedDatabase(names.database, legacyKey, false); }
  catch { throw new VaultAccessError("invalid_passphrase", "The passphrase is incorrect, or neither migration key can open the vault."); }
  return finalizeMigration(userId, oldDatabase, passphrase, bundle);
}

export async function openVault(userId: string, options: VaultOpenOptions = {}): Promise<Vault> {
  const names = vaultNames(userId);
  const rawMetadata = await SecureStore.getItemAsync(names.metadata, deviceOnly);
  const rawBundle = await SecureStore.getItemAsync(names.passphraseBundle, deviceOnly);
  if (rawMetadata) {
    let metadata: VaultMetadata;
    try { metadata = parseMetadata(rawMetadata, userId); }
    catch { throw new VaultAccessError("key_lost", "Vault metadata is invalid. Zoe refused to create or replace key material."); }
    if (metadata.mode === "biometric") return openLegacyBiometricVault(userId, rawMetadata);
    if (!options.passphrase) throw new VaultAccessError("passphrase_required", "Enter this account's vault passphrase.");
    if (metadata.mode === "migration") return resumeMigration(userId, options.passphrase, metadata, rawBundle);
    return openExistingPassphraseVault(userId, options.passphrase, rawMetadata, rawBundle);
  }
  if (rawBundle && !options.passphrase) throw new VaultAccessError("passphrase_required", "Vault setup was interrupted. Enter the same passphrase to verify and finish it.");
  if ((rawBundle || options.setupPassphrase) && options.passphrase) {
    const existing = setupInFlight.get(userId);
    if (existing) return existing;
    const setup = setupPassphraseVault(userId, options.passphrase).finally(() => setupInFlight.delete(userId));
    setupInFlight.set(userId, setup);
    return setup;
  }
  if (databaseExists(names.database)) return openLegacyBiometricVault(userId, null);
  throw new VaultAccessError("setup_required", "Create a strong passphrase to protect this new account vault.");
}
