import type { NativeCapability } from "./capabilities";

export function smartSpectraCapability(isAndroid: boolean, hasBuildKey: boolean, hasBrokerUrl: boolean = false): NativeCapability {
  if (!isAndroid) return { available: false, reason: "SmartSpectra requires the Android preview build." };
  if (!hasBuildKey && !hasBrokerUrl) return { available: false, reason: "This build does not contain the required secure SmartSpectra key and no QA broker is configured." };
  return { available: true };
}
