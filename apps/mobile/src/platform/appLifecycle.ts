import { VaultAccessError } from "./vault.types";

export function migrationRequiresCompletion(error: unknown): boolean {
  return error instanceof VaultAccessError && error.reason === "passphrase_required";
}

export function migrationBackAction(recoveryRequired: boolean): "sign-out" | "ready" {
  return recoveryRequired ? "sign-out" : "ready";
}

export async function lockThenClear(lock: (() => Promise<void>) | undefined, clear: () => void): Promise<void> {
  try {
    await lock?.();
  } catch {
    // A stale or already-closed database handle must never prevent state scrubbing.
  } finally {
    clear();
  }
}
