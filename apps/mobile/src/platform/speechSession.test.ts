import { describe, expect, it } from "vitest";
import { applyManualDraftEdit, OfflineSpeechSession, type OfflineSpeechAdapter, type SpeechAdapterEvent } from "./speechSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function fakeAdapter(overrides: Partial<OfflineSpeechAdapter> = {}) {
  let listener: (event: SpeechAdapterEvent) => void = () => undefined;
  let nextSessionId = 0;
  const calls = { start: 0, stop: 0, abort: 0 };
  const adapter: OfflineSpeechAdapter = {
    environment: () => ({ android: true, apiLevel: 34, onDeviceRecognizer: true }),
    locales: async () => ({ supported: ["en-US", "bn-BD"], installed: ["en-US"] }),
    permissionGranted: async () => true,
    requestPermission: async () => true,
    start: () => { calls.start += 1; nextSessionId += 1; return nextSessionId; },
    stop: () => { calls.stop += 1; },
    abort: () => { calls.abort += 1; },
    subscribe: (next) => { listener = next; return () => { listener = () => undefined; }; },
    ...overrides,
  };
  return { adapter, calls, emit: (event: SpeechAdapterEvent) => listener(event), lastSessionId: () => nextSessionId };
}

describe("offline speech session", () => {
  it("does not start when the requested model is not installed", async () => {
    const fake = fakeAdapter();
    const states: string[] = [];
    const session = new OfflineSpeechSession(fake.adapter, (state) => states.push(state.message), () => undefined);

    await session.requestPermissionAndStart("bn-BD");

    expect(fake.calls.start).toBe(0);
    expect(states.at(-1)).toContain("not installed");
  });

  it("requests permission explicitly and leaves denial as typed fallback", async () => {
    const fake = fakeAdapter({ permissionGranted: async () => false, requestPermission: async () => false });
    let last = "";
    const session = new OfflineSpeechSession(fake.adapter, (state) => { last = state.message; }, () => undefined);

    await session.requestPermissionAndStart("en-US");

    expect(fake.calls.start).toBe(0);
    expect(last).toContain("keep typing");
  });

  it("delivers partial and final text but never sends a chat message", async () => {
    const fake = fakeAdapter();
    const transcripts: Array<[string, boolean]> = [];
    const session = new OfflineSpeechSession(fake.adapter, () => undefined, (text, final) => transcripts.push([text, final]));
    await session.requestPermissionAndStart("en-US");

    const sessionId = fake.lastSessionId();
    fake.emit({ type: "result", sessionId, transcript: "partial", final: false });
    fake.emit({ type: "result", sessionId, transcript: "final draft", final: true });

    expect(transcripts).toEqual([["partial", false], ["final draft", true]]);
    expect(fake.calls.start).toBe(1);
  });

  it("aborts on cleanup and ignores late results", async () => {
    const fake = fakeAdapter();
    const transcripts: string[] = [];
    const session = new OfflineSpeechSession(fake.adapter, () => undefined, (text) => transcripts.push(text));
    await session.requestPermissionAndStart("en-US");

    session.cancel("navigation");
    fake.emit({ type: "result", sessionId: fake.lastSessionId(), transcript: "late private text", final: true });

    expect(fake.calls.abort).toBe(1);
    expect(transcripts).toEqual([]);
  });

  it("disposal on navigation or vault lock releases the recognizer", async () => {
    const fake = fakeAdapter();
    const transcripts: string[] = [];
    const session = new OfflineSpeechSession(fake.adapter, () => undefined, (text) => transcripts.push(text));
    await session.requestPermissionAndStart("en-US");

    session.dispose();
    fake.emit({ type: "result", sessionId: fake.lastSessionId(), transcript: "late after lock", final: true });

    expect(fake.calls.abort).toBe(1);
    expect(transcripts).toEqual([]);
  });

  it("surfaces network errors without starting a fallback recognizer", async () => {
    const fake = fakeAdapter();
    let last = "";
    const session = new OfflineSpeechSession(fake.adapter, (state) => { last = state.message; }, () => undefined);
    await session.requestPermissionAndStart("en-US");

    fake.emit({ type: "error", sessionId: fake.lastSessionId(), code: "network", message: "raw provider detail" });

    expect(fake.calls.start).toBe(1);
    expect(last).toContain("did not retry");
    expect(last).not.toContain("raw provider detail");
  });

  it("invalidates an installed-model check when lifecycle cancellation wins the await", async () => {
    const locales = deferred<{ supported: string[]; installed: string[] }>();
    const fake = fakeAdapter({ locales: () => locales.promise });
    let last = "";
    const session = new OfflineSpeechSession(fake.adapter, (state) => { last = state.message; }, () => undefined);

    const starting = session.requestPermissionAndStart("en-US");
    session.cancelForLifecycle();
    locales.resolve({ supported: ["en-US"], installed: ["en-US"] });
    await starting;

    expect(fake.calls.start).toBe(0);
    expect(last).toContain("left the foreground");
  });

  it("fails closed when a permission dialog resolves after background cancellation", async () => {
    const permission = deferred<boolean>();
    const permissionPrompted = deferred<void>();
    const fake = fakeAdapter({ permissionGranted: async () => false, requestPermission: () => permission.promise });
    let last = "";
    const session = new OfflineSpeechSession(fake.adapter, (state) => {
      last = state.message;
      if (state.message.startsWith("Waiting for microphone permission")) permissionPrompted.resolve();
    }, () => undefined);

    const starting = session.requestPermissionAndStart("en-US");
    await permissionPrompted.promise;
    session.cancelForLifecycle();
    permission.resolve(true);
    await starting;

    expect(fake.calls.start).toBe(0);
    expect(last).toContain("permission was interrupted");
    expect(last).toContain("microphone did not start");
  });

  it("isolates a new native session from late final, end, and error callbacks from the cancelled session", async () => {
    const fake = fakeAdapter();
    const transcripts: string[] = [];
    let last = "";
    const session = new OfflineSpeechSession(fake.adapter, (state) => { last = state.message; }, (text) => transcripts.push(text));
    await session.requestPermissionAndStart("en-US");
    const firstSessionId = fake.lastSessionId();
    session.cancel();
    await session.requestPermissionAndStart("en-US");
    const secondSessionId = fake.lastSessionId();

    fake.emit({ type: "result", sessionId: firstSessionId, transcript: "late A", final: true });
    fake.emit({ type: "end", sessionId: firstSessionId });
    fake.emit({ type: "error", sessionId: firstSessionId, code: "network", message: "late A error" });

    expect(session.isDictationInFlight()).toBe(true);
    expect(last).toContain("Listening on device");
    expect(transcripts).toEqual([]);

    fake.emit({ type: "result", sessionId: secondSessionId, transcript: "current B", final: false });
    expect(transcripts).toEqual(["current B"]);
  });

  it("cancels dictation before applying a manual edit and ignores later native text", async () => {
    const fake = fakeAdapter();
    let draft = "original";
    const session = new OfflineSpeechSession(fake.adapter, () => undefined, (text) => { draft = text; });
    await session.requestPermissionAndStart("en-US");
    const sessionId = fake.lastSessionId();

    applyManualDraftEdit(session, "patient correction", (value) => { draft = value; });
    fake.emit({ type: "result", sessionId, transcript: "late partial overwrite", final: false });

    expect(fake.calls.abort).toBe(1);
    expect(draft).toBe("patient correction");
    expect(session.isDictationInFlight()).toBe(false);
  });
});
