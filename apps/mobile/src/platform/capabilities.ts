import { Platform } from "react-native";

export interface NativeCapability {
  available: boolean;
  reason?: string;
}

export function getNativeCapabilities() {
  const isNative = Platform.OS === "android";
  return {
    sqlCipher: { available: isNative, reason: isNative ? undefined : "SQLCipher is verified only in a custom Android build." } as NativeCapability,
    prescriptionOcr: { available: false, reason: "The pinned ExecuTorch OCR model artifact is not installed yet." } as NativeCapability,
    onDeviceModel: { available: false, reason: "The pinned Qwen model artifact is not installed yet." } as NativeCapability,
    smartSpectra: { available: false, reason: isNative ? "Presage native SDK credentials and artifact are not linked yet." : "SmartSpectra requires the Android preview build." } as NativeCapability,
    onDeviceSpeech: { available: false, reason: isNative ? "Offline speech service capability must be probed on this device." : "Offline speech requires Android." } as NativeCapability
  };
}
