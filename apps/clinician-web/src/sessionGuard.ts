export type SignedOutViewerState = { status: "signed-out"; keyWasDiscarded: false };
export type ReadyToOpenViewerState = { status: "ready-to-open" };
export interface ShareReference { objectId: string; key: string }

export function createOneShotReference(initial: ShareReference | null) {
  let value = initial;
  return {
    take(): ShareReference | null {
      const taken = value;
      value = null;
      return taken;
    },
    clear(): void { value = null; },
    hasValue(): boolean { return value !== null; }
  };
}

export function captureAndScrubShareReference(
  location: Pick<Location, "pathname" | "search" | "hash">,
  replace: (url: string) => void
): ShareReference | null {
  const objectId = new URLSearchParams(location.search).get("objectId") ?? "";
  const encodedKey = location.hash.slice(1);
  if (location.hash) replace(`${location.pathname}${location.search}`);
  if (!encodedKey) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objectId)) {
    throw new Error("This link has an invalid encrypted share reference.");
  }
  const key = decodeURIComponent(encodedKey);
  if (!key) throw new Error("This link is missing its fragment key.");
  return { objectId, key };
}

/**
 * Auth owns the lifetime of decrypted data. A missing session always replaces
 * the current state, and any account change requires a fresh grant download.
 */
export function stateAfterAuthChange<T>(
  currentState: T,
  previousUserId: string | null,
  nextUserId: string | null
): T | SignedOutViewerState | ReadyToOpenViewerState {
  if (nextUserId === null) return { status: "signed-out", keyWasDiscarded: false };
  if (previousUserId !== nextUserId) return { status: "ready-to-open" };
  return currentState;
}

export function canCommitDecryptedContent(openingUserId: string, currentUserId: string | null): boolean {
  return openingUserId === currentUserId;
}
