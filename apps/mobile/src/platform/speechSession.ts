import {
  isLocaleInstalled,
  offlineEnvironmentReason,
  speechErrorMessage,
  type SpeechEnvironment,
  type SpeechLocaleSet,
} from "./speechPolicy";

export type SpeechAdapterEvent =
  | { type: "start"; sessionId: number }
  | { type: "end"; sessionId: number }
  | { type: "result"; sessionId: number; transcript: string; final: boolean }
  | { type: "error"; sessionId: number; code: string; message: string };

export interface OfflineSpeechAdapter {
  environment(): SpeechEnvironment;
  locales(): Promise<SpeechLocaleSet>;
  permissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  start(locale: string): number;
  stop(): void;
  abort(): void;
  subscribe(listener: (event: SpeechAdapterEvent) => void): () => void;
}

export interface SpeechComposerState {
  available: boolean;
  listening: boolean;
  locale: string;
  permissionGranted: boolean;
  message: string;
  errorCode?: string;
}

export class OfflineSpeechSession {
  private activeSessionId: number | null = null;
  private disposed = false;
  private operationGeneration = 0;
  private pendingStart = false;
  private pendingPermission = false;
  private readonly unsubscribe: () => void;
  private lastState: SpeechComposerState = { available: false, listening: false, locale: "", permissionGranted: false, message: "Checking offline speech…" };

  constructor(
    private readonly adapter: OfflineSpeechAdapter,
    private readonly onState: (state: SpeechComposerState) => void,
    private readonly onTranscript: (transcript: string, final: boolean) => void,
  ) {
    this.unsubscribe = adapter.subscribe((event) => this.handle(event));
  }

  async probe(locale: string): Promise<SpeechComposerState> {
    const generation = this.nextOperation();
    return this.probeForOperation(locale, generation);
  }

  private async probeForOperation(locale: string, generation: number): Promise<SpeechComposerState> {
    const environmentReason = offlineEnvironmentReason(this.adapter.environment());
    if (environmentReason) return this.publish({ available: false, listening: false, locale, permissionGranted: false, message: environmentReason });
    try {
      const [locales, permissionGranted] = await Promise.all([this.adapter.locales(), this.adapter.permissionGranted()]);
      if (!this.isCurrentOperation(generation)) return this.lastState;
      if (!isLocaleInstalled(locale, locales.installed)) {
        const supported = locales.supported.some((candidate) => candidate.toLowerCase() === locale.toLowerCase());
        return this.publish({
          available: false,
          listening: false,
          locale,
          permissionGranted,
          message: supported
            ? `${locale} is supported but its offline model is not installed. Zoe will not download it or use network transcription.`
            : `${locale} is not available in the installed on-device recognizer. You can keep typing.`,
          errorCode: supported ? "language-not-installed" : "language-not-supported",
        });
      }
      return this.publish({
        available: true,
        listening: false,
        locale,
        permissionGranted,
        message: permissionGranted ? `Offline dictation ready · ${locale}` : `Microphone permission is required for offline dictation · ${locale}`,
      });
    } catch (caught) {
      if (!this.isCurrentOperation(generation)) return this.lastState;
      return this.publish({
        available: false,
        listening: false,
        locale,
        permissionGranted: false,
        message: "Could not verify the installed offline speech model. Zoe will not use network transcription; you can keep typing.",
        errorCode: "support-check-failed",
      });
    }
  }

  async requestPermissionAndStart(locale: string): Promise<void> {
    if (this.disposed) return;
    const generation = this.nextOperation();
    this.pendingStart = true;
    const status = await this.probeForOperation(locale, generation);
    if (!this.isCurrentOperation(generation) || !status.available) {
      if (this.isCurrentOperation(generation)) this.pendingStart = false;
      return;
    }
    let granted = status.permissionGranted;
    if (!granted) {
      this.pendingPermission = true;
      this.publish({ ...status, listening: false, message: "Waiting for microphone permission… Zoe will start only while this request remains active." });
      granted = await this.adapter.requestPermission();
      if (!this.isCurrentOperation(generation)) return;
      this.pendingPermission = false;
    }
    if (!granted) {
      this.pendingStart = false;
      this.publish({ ...status, permissionGranted: false, message: "Microphone permission was not granted. You can keep typing.", errorCode: "not-allowed" });
      return;
    }
    try {
      const sessionId = this.adapter.start(locale);
      if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("Native speech session was not created");
      if (!this.isCurrentOperation(generation)) {
        this.adapter.abort();
        return;
      }
      this.pendingStart = false;
      this.activeSessionId = sessionId;
      this.publish({ ...status, permissionGranted: true, listening: true, message: "Listening on device… Review the draft before tapping Send." });
    } catch (caught) {
      if (!this.isCurrentOperation(generation)) return;
      this.pendingStart = false;
      this.activeSessionId = null;
      this.publish({ ...status, permissionGranted: true, listening: false, message: "Offline dictation could not start. You can keep typing.", errorCode: "start-failed" });
    }
  }

  stop(): void {
    if (this.activeSessionId === null) return;
    this.adapter.stop();
    this.publish({ ...this.lastState, listening: false, message: "Finishing on-device transcription…" });
  }

  cancel(reason = "Offline dictation cancelled."): void {
    this.nextOperation();
    const hadNativeSession = this.activeSessionId !== null;
    this.activeSessionId = null;
    this.pendingStart = false;
    this.pendingPermission = false;
    if (hadNativeSession) this.adapter.abort();
    this.publish({ ...this.lastState, listening: false, message: reason });
  }

  cancelForLifecycle(): void {
    this.cancel(this.pendingPermission
      ? "Microphone permission was interrupted when Zoe left the foreground. Permission may have changed, but the microphone did not start; tap Dictate again."
      : "Offline dictation cancelled because Zoe left the foreground.");
  }

  isDictationInFlight(): boolean {
    return this.pendingStart || this.activeSessionId !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.nextOperation();
    const hadNativeSession = this.activeSessionId !== null;
    this.activeSessionId = null;
    this.pendingStart = false;
    this.pendingPermission = false;
    this.disposed = true;
    if (hadNativeSession) this.adapter.abort();
    this.unsubscribe();
  }

  private handle(event: SpeechAdapterEvent): void {
    if (this.disposed || event.sessionId !== this.activeSessionId) return;
    if (event.type === "result") {
      this.onTranscript(event.transcript, event.final);
      if (event.final) {
        this.activeSessionId = null;
        this.publish({ ...this.lastState, listening: false, message: "Transcript ready to edit. Zoe did not send it." });
      }
      return;
    }
    if (event.type === "error") {
      this.activeSessionId = null;
      if (event.code === "aborted") return;
      this.publish({
        ...this.lastState,
        listening: false,
        message: speechErrorMessage(event.code),
        errorCode: event.code,
      });
      return;
    }
    if (event.type === "end") {
      this.activeSessionId = null;
      this.publish({ ...this.lastState, listening: false, message: "Offline dictation ended. Review the draft before tapping Send." });
    }
  }

  private publish(state: SpeechComposerState): SpeechComposerState {
    this.lastState = state;
    if (!this.disposed) this.onState(state);
    return state;
  }

  private nextOperation(): number {
    this.operationGeneration += 1;
    return this.operationGeneration;
  }

  private isCurrentOperation(generation: number): boolean {
    return !this.disposed && generation === this.operationGeneration;
  }
}

export function applyManualDraftEdit(
  session: OfflineSpeechSession | null,
  value: string,
  setDraft: (value: string) => void,
): void {
  if (session?.isDictationInFlight()) {
    session.cancel("Offline dictation cancelled because you edited the draft. Your edit was kept.");
  }
  setDraft(value);
}
