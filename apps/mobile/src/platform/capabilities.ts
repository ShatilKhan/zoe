import { Platform } from "react-native";
import PresageSensor from "@zoe/presage-sensor";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { smartSpectraCapability } from "./capabilityPolicy";

export interface NativeCapability {
  available: boolean;
  reason?: string;
}

export function getNativeCapabilities() {
  const isNative = Platform.OS === "android";
  const androidApi = typeof Platform.Version === "number" ? Platform.Version : Number.parseInt(String(Platform.Version), 10) || 0;
  const strictOfflineSpeech = isNative && androidApi >= 33 && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  return {
    sqlCipher: { available: isNative, reason: isNative ? undefined : "SQLCipher is verified only in a custom Android build." } as NativeCapability,
    prescriptionOcr: { available: false, reason: "On-device OCR is not included in this patient preview yet." } as NativeCapability,
    onDeviceModel: { available: false, reason: "On-device generated answers are not included in this patient preview yet." } as NativeCapability,
    smartSpectra: smartSpectraCapability(isNative, PresageSensor.available),
    onDeviceSpeech: { available: strictOfflineSpeech, reason: strictOfflineSpeech ? undefined : isNative ? "Android 13+ with an installed on-device speech model is required." : "Offline speech requires Android; typed chat remains available." } as NativeCapability
  };
}
