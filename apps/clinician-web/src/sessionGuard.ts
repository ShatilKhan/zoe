export type SignedOutViewerState = { status: "signed-out"; keyWasDiscarded: false };
export type ReadyToOpenViewerState = { status: "ready-to-open" };

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
