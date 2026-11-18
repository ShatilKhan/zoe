import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  dbs: new Map<string, { exists: boolean; expectedKey: string | null; canary: boolean; records: string[]; operations: string[] }>(),
  randomCalls: 0,
  deriveCalls: 0,
  biometricInvalidated: false,
  metadataWriteFailures: 0,
  completedMigrationMetadataFailures: 0
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(async (name: string, options?: { requireAuthentication?: boolean }) => {
    if (options?.requireAuthentication && state.biometricInvalidated) throw new Error("key permanently invalidated");
    return state.secure.get(name) ?? null;
  }),
  setItemAsync: vi.fn(async (name: string, value: string) => {
    if (name.includes(".metadata.") && state.completedMigrationMetadataFailures > 0) {
      const incoming = JSON.parse(value) as { mode?: string };
      const currentRaw = state.secure.get(name);
      const current = currentRaw ? JSON.parse(currentRaw) as { mode?: string } : null;
      if (incoming.mode === "passphrase" && current?.mode === "migration") {
        state.completedMigrationMetadataFailures -= 1;
        throw new Error("synthetic migration finalization interruption");
      }
    }
    if (name.includes(".metadata.") && state.metadataWriteFailures > 0) {
      state.metadataWriteFailures -= 1;
      throw new Error("synthetic metadata write interruption");
    }
    state.secure.set(name, value);
  })
}));

vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: vi.fn(async (length: number) => {
    state.randomCalls += 1;
    return new Uint8Array(length).fill(state.randomCalls);
  })
}));

vi.mock("expo-file-system", () => ({
  File: class {
    private readonly name: string;
    constructor(uri: string) {
      if (!uri.startsWith("file:///")) throw new Error("URI is not absolute");
      this.name = uri.slice(uri.lastIndexOf("/") + 1);
    }
    get exists() { return state.dbs.get(this.name)?.exists ?? false; }
  }
}));

vi.mock("expo-sqlite", () => ({
  defaultDatabaseDirectory: "db-dir",
  openDatabaseAsync: vi.fn(async (name: string) => {
    const data = state.dbs.get(name) ?? { exists: true, expectedKey: null, canary: false, records: [], operations: [] };
    data.exists = true;
    state.dbs.set(name, data);
    let suppliedKey = "";
    const assertKey = () => {
      if (data.expectedKey !== null && suppliedKey !== data.expectedKey) throw new Error("file is not a database");
    };
    return {
      execAsync: vi.fn(async (sql: string) => {
        if (sql.startsWith("PRAGMA key")) {
          suppliedKey = /x'([0-9a-f]+)'/i.exec(sql)?.[1] ?? "";
          data.operations.push("key");
          return;
        }
        if (sql.startsWith("PRAGMA rekey")) {
          assertKey();
          data.expectedKey = /x'([0-9a-f]+)'/i.exec(sql)?.[1] ?? "";
          suppliedKey = data.expectedKey;
          data.operations.push("rekey");
          return;
        }
        assertKey();
        if (sql.includes("CREATE TABLE vault_canary")) {
          data.operations.push("canary");
          data.canary = true;
          data.expectedKey = suppliedKey;
        }
        if (sql.includes("CREATE TABLE IF NOT EXISTS records")) data.operations.push("records");
      }),
      getFirstAsync: vi.fn(async (sql: string) => {
        if (sql === "PRAGMA cipher_version;") return { cipher_version: "4.6-test" };
        assertKey();
        if (sql.includes("sqlite_master")) return data.canary ? { name: "vault_canary" } : null;
        if (sql.includes("FROM vault_canary")) return data.canary ? { value: "zoe-vault-canary-v1" } : null;
        return null;
      }),
      getAllAsync: vi.fn(async () => data.records.map((body) => ({ body }))),
      withTransactionAsync: vi.fn(async (operation: () => Promise<void>) => operation()),
      runAsync: vi.fn(async () => undefined),
      closeAsync: vi.fn(async () => { data.operations.push("close"); })
    };
  })
}));

vi.mock("@zoe/share-crypto", () => ({
  default: {
    deriveVaultKey: vi.fn(async (passphrase: string, secret: string, salt: string, namespace: string) => {
      state.deriveCalls += 1;
      const input = `${passphrase}|${secret}|${salt}|${namespace}`;
      let hash = 2166136261;
      for (const character of input) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return (Math.abs(hash).toString(16).padStart(8, "0")).repeat(8).slice(0, 64);
    })
  }
}));

import { openVault, sqliteDatabaseFileUri, VaultAccessError } from "./vault.native";

const passphrase = "Maple!Orbit7 Glass River";

beforeEach(() => {
  state.secure.clear();
  state.dbs.clear();
  state.randomCalls = 0;
  state.deriveCalls = 0;
  state.biometricInvalidated = false;
  state.metadataWriteFailures = 0;
  state.completedMigrationMetadataFailures = 0;
  vi.clearAllMocks();
});

async function create(account = "account-a") {
  await expect(openVault(account)).rejects.toMatchObject({ reason: "setup_required" });
  return openVault(account, { passphrase, setupPassphrase: true });
}

describe("native vault lifecycle", () => {
  it("constructs an absolute File URI from Android's raw SQLite directory", () => {
    expect(sqliteDatabaseFileUri("/data/user/0/app.zoe.health/databases", "zoe-account-a.db")).toBe("file:///data/user/0/app.zoe.health/databases/zoe-account-a.db");
    expect(sqliteDatabaseFileUri("file:///data/user/0/app.zoe.health/databases/", "zoe-account-a.db")).toBe("file:///data/user/0/app.zoe.health/databases/zoe-account-a.db");
    expect(() => sqliteDatabaseFileUri("content://provider", "zoe-account-a.db")).toThrow("local file path");
  });
  it("opens with the correct passphrase after restart and rejects a wrong one without writes", async () => {
    const vault = await create();
    await vault.lock();
    const db = state.dbs.get("zoe-account-a.db")!;
    const operationsBefore = [...db.operations];
    const keyBefore = db.expectedKey;
    const secureBefore = [...state.secure.entries()];
    await expect(openVault("account-a", { passphrase: "Wrong!Orbit7 Glass River" })).rejects.toMatchObject({ reason: "invalid_passphrase" });
    const stateChanges = (operations: string[]) => operations.filter((operation) => !["key", "close"].includes(operation));
    expect(stateChanges(db.operations)).toEqual(stateChanges(operationsBefore));
    expect(db.expectedKey).toBe(keyBefore);
    expect([...state.secure.entries()]).toEqual(secureBefore);
    await expect(openVault("account-a", { passphrase })).resolves.toMatchObject({ mode: "sqlcipher" });
  });

  it("isolates account namespaces and keys", async () => {
    await create("account-a");
    await create("account-b");
    expect(state.dbs.get("zoe-account-a.db")?.expectedKey).not.toBe(state.dbs.get("zoe-account-b.db")?.expectedKey);
    expect([...state.secure.keys()].every((key) => key.includes("account-a") || key.includes("account-b"))).toBe(true);
  });

  it("fails closed when an initialized vault loses its device secret", async () => {
    await create();
    state.secure.delete("zoe.vault.device.v1.account-a");
    await expect(openVault("account-a", { passphrase })).rejects.toMatchObject({ reason: "key_lost" });
    expect(state.randomCalls).toBe(2);
  });

  it("rejects copied metadata and database without a decryptable Keystore secret", async () => {
    await create();
    state.secure.delete("zoe.vault.device.v1.account-a");
    await expect(openVault("account-a", { passphrase, setupPassphrase: true })).rejects.toBeInstanceOf(VaultAccessError);
    expect(state.dbs.get("zoe-account-a.db")?.operations.filter((operation) => operation === "canary")).toHaveLength(1);
  });

  it("rejects salt tampering before opening or mutating the database", async () => {
    await create();
    const metadataKey = "zoe.vault.metadata.v1.account-a";
    const metadata = JSON.parse(state.secure.get(metadataKey)!) as Record<string, unknown>;
    state.secure.set(metadataKey, JSON.stringify({ ...metadata, salt: btoa(String.fromCharCode(...new Uint8Array(16).fill(9))) }));
    const before = [...state.dbs.get("zoe-account-a.db")!.operations];
    await expect(openVault("account-a", { passphrase })).rejects.toMatchObject({ reason: "key_lost" });
    expect(state.dbs.get("zoe-account-a.db")!.operations).toEqual(before);
  });

  it("single-flights concurrent first setup and creates the canary before records", async () => {
    const [first, second] = await Promise.all([
      openVault("account-a", { passphrase, setupPassphrase: true }),
      openVault("account-a", { passphrase, setupPassphrase: true })
    ]);
    expect(first.mode).toBe("sqlcipher");
    expect(second.mode).toBe("sqlcipher");
    expect(state.randomCalls).toBe(2);
    expect(state.deriveCalls).toBe(1);
    const operations = state.dbs.get("zoe-account-a.db")!.operations;
    expect(operations.indexOf("canary")).toBeLessThan(operations.indexOf("records"));
  });

  it("resumes setup after the database canary exists but metadata persistence was interrupted", async () => {
    state.metadataWriteFailures = 1;
    await expect(openVault("account-a", { passphrase, setupPassphrase: true })).rejects.toMatchObject({ reason: "passphrase_required" });
    expect(state.secure.has("zoe.vault.metadata.v1.account-a")).toBe(false);
    expect(state.secure.has("zoe.vault.device.v1.account-a")).toBe(true);
    const database = state.dbs.get("zoe-account-a.db")!;
    expect(database.canary).toBe(true);
    expect(database.operations.filter((operation) => operation === "canary")).toHaveLength(1);
    await expect(openVault("account-a")).rejects.toMatchObject({ reason: "passphrase_required" });
    const resumed = await openVault("account-a", { passphrase });
    expect(resumed).toMatchObject({ protection: "passphrase", isNew: true });
    expect(state.randomCalls).toBe(2);
    expect(database.operations.filter((operation) => operation === "canary")).toHaveLength(1);
    expect(state.secure.has("zoe.vault.metadata.v1.account-a")).toBe(true);
  });

  it("stores no passphrase or derived SQLCipher key", async () => {
    await create();
    const stored = [...state.secure.values()].join("\n");
    expect(stored).not.toContain(passphrase);
    expect(stored).not.toContain(state.dbs.get("zoe-account-a.db")!.expectedKey!);
  });

  it("never replaces a missing or invalidated legacy biometric key", async () => {
    const legacyKey = "a".repeat(64);
    state.secure.set("zoe.vault.account-a", legacyKey);
    state.dbs.set("zoe-account-a.db", { exists: true, expectedKey: legacyKey, canary: false, records: [], operations: [] });
    const vault = await openVault("account-a");
    expect(vault.protection).toBe("biometric");
    await vault.lock();
    state.secure.delete("zoe.vault.account-a");
    await expect(openVault("account-a")).rejects.toMatchObject({ reason: "key_lost" });
    expect(state.secure.has("zoe.vault.account-a")).toBe(false);
    state.secure.set("zoe.vault.account-a", legacyKey);
    state.biometricInvalidated = true;
    await expect(openVault("account-a")).rejects.toMatchObject({ reason: "biometric_unavailable" });
  });

  it("migrates a biometric vault only while its old key is readable", async () => {
    const legacyKey = "b".repeat(64);
    state.secure.set("zoe.vault.account-a", legacyKey);
    state.dbs.set("zoe-account-a.db", { exists: true, expectedKey: legacyKey, canary: false, records: [], operations: [] });
    const biometricVault = await openVault("account-a");
    const migrated = await biometricVault.migrateToPassphrase!(passphrase);
    expect(migrated.protection).toBe("passphrase");
    expect(state.dbs.get("zoe-account-a.db")?.operations).toContain("rekey");
    state.secure.delete("zoe.vault.account-a");
    await migrated.lock();
    await expect(openVault("account-a", { passphrase })).resolves.toMatchObject({ protection: "passphrase" });
  });

  it("closes and resumes an already-rekeyed migration when final metadata writes fail", async () => {
    const legacyKey = "c".repeat(64);
    const metadataKey = "zoe.vault.metadata.v1.account-a";
    state.secure.set("zoe.vault.account-a", legacyKey);
    state.dbs.set("zoe-account-a.db", { exists: true, expectedKey: legacyKey, canary: false, records: [], operations: [] });
    const biometricVault = await openVault("account-a");
    const database = state.dbs.get("zoe-account-a.db")!;
    state.completedMigrationMetadataFailures = 2;

    await expect(biometricVault.migrateToPassphrase!(passphrase)).rejects.toMatchObject({ reason: "passphrase_required" });
    expect(JSON.parse(state.secure.get(metadataKey)!) as { mode: string }).toMatchObject({ mode: "migration" });
    expect(database.operations.filter((operation) => operation === "rekey")).toHaveLength(1);
    expect(database.operations.filter((operation) => operation === "close")).toHaveLength(2);

    await expect(biometricVault.migrateToPassphrase!(passphrase)).rejects.toMatchObject({ reason: "passphrase_required" });
    expect(JSON.parse(state.secure.get(metadataKey)!) as { mode: string }).toMatchObject({ mode: "migration" });
    expect(database.operations.filter((operation) => operation === "rekey")).toHaveLength(1);
    expect(database.operations.filter((operation) => operation === "close")).toHaveLength(3);

    const migrated = await biometricVault.migrateToPassphrase!(passphrase);
    expect(migrated.protection).toBe("passphrase");
    expect(JSON.parse(state.secure.get(metadataKey)!) as { mode: string }).toMatchObject({ mode: "passphrase" });
    expect(database.operations.filter((operation) => operation === "rekey")).toHaveLength(1);
  });

  it("recovers from a persisted migration marker through a fresh openVault call", async () => {
    const legacyKey = "d".repeat(64);
    const metadataKey = "zoe.vault.metadata.v1.account-a";
    state.secure.set("zoe.vault.account-a", legacyKey);
    state.dbs.set("zoe-account-a.db", { exists: true, expectedKey: legacyKey, canary: false, records: [], operations: [] });
    const biometricVault = await openVault("account-a");
    const database = state.dbs.get("zoe-account-a.db")!;
    state.completedMigrationMetadataFailures = 1;

    await expect(biometricVault.migrateToPassphrase!(passphrase)).rejects.toMatchObject({ reason: "passphrase_required" });
    expect(JSON.parse(state.secure.get(metadataKey)!) as { mode: string }).toMatchObject({ mode: "migration" });

    const recovered = await openVault("account-a", { passphrase });
    expect(recovered.protection).toBe("passphrase");
    expect(JSON.parse(state.secure.get(metadataKey)!) as { mode: string }).toMatchObject({ mode: "passphrase" });
    expect(database.operations.filter((operation) => operation === "rekey")).toHaveLength(1);
  });
});
