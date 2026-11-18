import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { createExpoOfflineSpeechAdapter, OfflineSpeechSession } from "./offlineSpeech";
import { mergeEditableTranscript, normalizeLocale } from "./speechPolicy";
import { applyManualDraftEdit, type SpeechComposerState } from "./speechSession";

function deviceLocale(): string {
  try {
    return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale || "en-US");
  } catch {
    return "en-US";
  }
}

const initialState: SpeechComposerState = {
  available: false,
  listening: false,
  locale: deviceLocale(),
  permissionGranted: false,
  message: "Checking installed offline speech…",
};

export function useOfflineSpeechComposer(draft: string, setDraft: (value: string) => void) {
  const [state, setState] = useState<SpeechComposerState>(initialState);
  const sessionRef = useRef<OfflineSpeechSession | null>(null);
  const draftRef = useRef(draft);
  const dictationBaseRef = useRef("");
  draftRef.current = draft;

  useEffect(() => {
    const session = new OfflineSpeechSession(
      createExpoOfflineSpeechAdapter(),
      setState,
      (transcript) => setDraft(mergeEditableTranscript(dictationBaseRef.current, transcript)),
    );
    sessionRef.current = session;
    void session.probe(initialState.locale);
    const appState = AppState.addEventListener("change", (next) => {
      if (next !== "active") session.cancelForLifecycle();
    });
    return () => {
      appState.remove();
      session.dispose();
      sessionRef.current = null;
    };
  }, [setDraft]);

  async function toggle(): Promise<void> {
    const session = sessionRef.current;
    if (!session) return;
    if (state.listening) {
      session.stop();
      return;
    }
    dictationBaseRef.current = draftRef.current;
    await session.requestPermissionAndStart(state.locale);
  }

  function updateDraft(value: string): void {
    applyManualDraftEdit(sessionRef.current, value, setDraft);
  }

  return { state, toggle, updateDraft };
}
