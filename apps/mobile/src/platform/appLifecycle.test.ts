import { describe, expect, it, vi } from "vitest";
import { VaultAccessError } from "./vault.types";
import { lockThenClear, migrationBackAction, migrationRequiresCompletion } from "./appLifecycle";

describe("sensitive app lifecycle", () => {
  it("does not allow Back to expose a closed vault after post-rekey finalization fails", () => {
    const error = new VaultAccessError("passphrase_required", "migration finalization interrupted");
    expect(migrationRequiresCompletion(error)).toBe(true);
    expect(migrationBackAction(migrationRequiresCompletion(error))).toBe("sign-out");
    expect(migrationBackAction(false)).toBe("ready");
  });

  it("clears sensitive state when background locking an already-closed vault fails", async () => {
    const events: string[] = [];
    const lock = vi.fn(async () => {
      events.push("lock");
      throw new Error("database is already closed");
    });
    const clear = vi.fn(() => events.push("clear"));

    await expect(lockThenClear(lock, clear)).resolves.toBeUndefined();
    expect(events).toEqual(["lock", "clear"]);
    expect(clear).toHaveBeenCalledOnce();
  });
});
