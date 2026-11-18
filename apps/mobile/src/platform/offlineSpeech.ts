import { Platform } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { OfflineSpeechSession, type OfflineSpeechAdapter, type SpeechAdapterEvent } from "./speechSession";

type SessionAwareSpeechModule = Omit<typeof ExpoSpeechRecognitionModule, "start"> & {
  start(options: Parameters<typeof ExpoSpeechRecognitionModule.start>[0]): number;
};

type NativeSessionEvent = { sessionId?: number };

const sessionAwareSpeechModule = ExpoSpeechRecognitionModule as SessionAwareSpeechModule;

function nativeSessionId(event: NativeSessionEvent | null | undefined): number | null {
  return Number.isSafeInteger(event?.sessionId) && (event?.sessionId ?? 0) > 0 ? event!.sessionId! : null;
}

function androidApiLevel(): number {
  return typeof Platform.Version === "number" ? Platform.Version : Number.parseInt(String(Platform.Version), 10) || 0;
}

export function createExpoOfflineSpeechAdapter(): OfflineSpeechAdapter {
  return {
    environment: () => ({
      android: Platform.OS === "android",
      apiLevel: androidApiLevel(),
      onDeviceRecognizer: Platform.OS === "android" && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    }),
    locales: async () => {
      const result = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      return { supported: result.locales, installed: result.installedLocales };
    },
    permissionGranted: async () => (await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()).granted,
    requestPermission: async () => (await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()).granted,
    start: (locale) => sessionAwareSpeechModule.start({
      lang: locale,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
    }),
    stop: () => ExpoSpeechRecognitionModule.stop(),
    abort: () => ExpoSpeechRecognitionModule.abort(),
    subscribe: (listener) => {
      const emit = (event: SpeechAdapterEvent) => listener(event);
      const subscriptions = [
        ExpoSpeechRecognitionModule.addListener("start", (event) => {
          const sessionId = nativeSessionId(event as unknown as NativeSessionEvent);
          if (sessionId !== null) emit({ type: "start", sessionId });
        }),
        ExpoSpeechRecognitionModule.addListener("end", (event) => {
          const sessionId = nativeSessionId(event as unknown as NativeSessionEvent);
          if (sessionId !== null) emit({ type: "end", sessionId });
        }),
        ExpoSpeechRecognitionModule.addListener("result", (event: ExpoSpeechRecognitionResultEvent) => {
          const sessionId = nativeSessionId(event as ExpoSpeechRecognitionResultEvent & NativeSessionEvent);
          if (sessionId !== null) emit({
            type: "result",
            sessionId,
            transcript: event.results[0]?.transcript ?? "",
            final: event.isFinal,
          });
        }),
        ExpoSpeechRecognitionModule.addListener("error", (event: ExpoSpeechRecognitionErrorEvent) => {
          const sessionId = nativeSessionId(event as ExpoSpeechRecognitionErrorEvent & NativeSessionEvent);
          if (sessionId !== null) emit({
            type: "error",
            sessionId,
            code: event.error,
            message: event.message,
          });
        }),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    },
  };
}

export { OfflineSpeechSession };
