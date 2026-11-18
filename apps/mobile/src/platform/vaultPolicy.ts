const weakPassphrases = new Set([
  "password", "password123", "qwerty123", "letmein", "iloveyou", "admin123", "welcome123",
  "correcthorsebatterystaple", "1234567890123456"
]);

export const VAULT_KDF_VERSION = 1 as const;
export const VAULT_CANARY = "zoe-vault-canary-v1";

export interface PassphraseBundle {
  version: typeof VAULT_KDF_VERSION;
  userId: string;
  mode: "passphrase";
  salt: string;
  deviceSecret: string;
}

export interface VaultMetadata {
  version: typeof VAULT_KDF_VERSION;
  userId: string;
  mode: "passphrase" | "biometric" | "migration";
  salt?: string;
  initialized: true;
}

export function assertVaultUserId(userId: string): void {
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(userId)) throw new Error("User vault namespace is invalid.");
}

export function vaultNames(userId: string) {
  assertVaultUserId(userId);
  return {
    metadata: `zoe.vault.metadata.v1.${userId}`,
    passphraseBundle: `zoe.vault.device.v1.${userId}`,
    legacyBiometricKey: `zoe.vault.${userId}`,
    database: `zoe-${userId}.db`,
    kdfNamespace: `${userId}:passphrase`
  };
}

export function validateNewPassphrase(passphrase: string, userId: string): string | null {
  const normalized = passphrase.normalize("NFKC");
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
  const compactUserId = userId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length < 16) return "Use at least 16 characters.";
  if (normalized.length > 128) return "Use no more than 128 characters.";
  if (weakPassphrases.has(compact) || compact.includes("password") || compact.includes("qwerty")) return "Choose a less common passphrase.";
  if (compactUserId && compact.includes(compactUserId)) return "Do not include the account ID in the passphrase.";
  if (/(.)\1{4,}/u.test(normalized) || /(?:012345|123456|234567|abcdef|qwerty)/i.test(normalized)) return "Avoid repeated characters and common sequences.";
  const classes = [/[a-z]/.test(normalized), /[A-Z]/.test(normalized), /\d/.test(normalized), /[^A-Za-z0-9\s]/.test(normalized)].filter(Boolean).length;
  const words = normalized.trim().split(/\s+/).filter((word) => word.length >= 3);
  if (!(classes >= 3 || (normalized.length >= 24 && words.length >= 4))) return "Use three character types, or at least four unrelated words totaling 24 characters.";
  if (new Set(normalized.toLowerCase()).size < 10) return "Use a more varied passphrase.";
  return null;
}

export function parseBundle(raw: string, userId: string): PassphraseBundle {
  const value = JSON.parse(raw) as Partial<PassphraseBundle>;
  if (value.version !== VAULT_KDF_VERSION || value.userId !== userId || value.mode !== "passphrase" || typeof value.salt !== "string" || typeof value.deviceSecret !== "string") {
    throw new Error("Vault device-key metadata was changed or belongs to another account.");
  }
  let saltBytes: Uint8Array;
  let secretBytes: Uint8Array;
  try {
    saltBytes = Uint8Array.from(atob(value.salt), (character) => character.charCodeAt(0));
    secretBytes = Uint8Array.from(atob(value.deviceSecret), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Vault device-key encoding is invalid.");
  }
  if (saltBytes.length !== 16 || secretBytes.length !== 32) throw new Error("Vault device-key lengths are invalid.");
  return value as PassphraseBundle;
}

export function parseMetadata(raw: string, userId: string): VaultMetadata {
  const value = JSON.parse(raw) as Partial<VaultMetadata>;
  if (value.version !== VAULT_KDF_VERSION || value.userId !== userId || value.initialized !== true || (value.mode !== "passphrase" && value.mode !== "biometric" && value.mode !== "migration")) {
    throw new Error("Vault metadata was changed or belongs to another account.");
  }
  if ((value.mode === "passphrase" || value.mode === "migration") && typeof value.salt !== "string") throw new Error("Vault KDF metadata is incomplete.");
  return value as VaultMetadata;
}

export class UnlockRateLimiter {
  private failures = 0;
  private blockedUntil = 0;

  remainingMs(now = Date.now()): number { return Math.max(0, this.blockedUntil - now); }
  recordSuccess(): void { this.failures = 0; this.blockedUntil = 0; }
  recordFailure(now = Date.now()): number {
    this.failures += 1;
    if (this.failures >= 5) this.blockedUntil = now + Math.min(60_000, 5_000 * 2 ** (this.failures - 5));
    return this.remainingMs(now);
  }
}
