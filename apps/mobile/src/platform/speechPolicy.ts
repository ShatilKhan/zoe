export const MIN_STRICT_OFFLINE_ANDROID_API = 33;

export interface SpeechEnvironment {
  android: boolean;
  apiLevel: number;
  onDeviceRecognizer: boolean;
}

export interface SpeechLocaleSet {
  supported: string[];
  installed: string[];
}

export function normalizeLocale(locale: string): string {
  return locale.trim().replace("_", "-");
}

export function isLocaleInstalled(locale: string, installed: string[]): boolean {
  const requested = normalizeLocale(locale).toLowerCase();
  return installed.some((candidate) => normalizeLocale(candidate).toLowerCase() === requested);
}

export function offlineEnvironmentReason(environment: SpeechEnvironment): string | null {
  if (!environment.android) return "Offline dictation is available only in Zoe's Android app. You can keep typing here.";
  if (environment.apiLevel < MIN_STRICT_OFFLINE_ANDROID_API) return "Zoe requires Android 13 or newer to verify an installed offline speech model. You can keep typing.";
  if (!environment.onDeviceRecognizer) return "This device has no on-device speech recognizer. Zoe will not use network transcription; you can keep typing.";
  return null;
}

export function mergeEditableTranscript(existingDraft: string, transcript: string): string {
  const base = existingDraft.trimEnd();
  const spoken = transcript.trim();
  if (!base) return spoken;
  if (!spoken) return base;
  return `${base} ${spoken}`;
}

export function speechErrorMessage(code: string): string {
  if (code === "network") return "The on-device recognizer reported a network error. Zoe did not retry through a network service; you can keep typing.";
  if (code === "language-not-supported") return "The selected language is unavailable on device. Zoe will not use network transcription; you can keep typing.";
  if (code === "not-allowed") return "Microphone permission was not granted. You can keep typing.";
  if (code === "no-speech" || code === "speech-timeout") return "No speech was detected. Try again or keep typing.";
  return "Offline dictation stopped. You can keep typing.";
}
