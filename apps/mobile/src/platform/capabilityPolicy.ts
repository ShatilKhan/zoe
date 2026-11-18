import type { NativeCapability } from "./capabilities";

export function smartSpectraCapability(isAndroid: boolean, hasBuildKey: boolean): NativeCapability {
  if (!isAndroid) return { available: false, reason: "SmartSpectra requires the Android preview build." };
  if (!hasBuildKey) return { available: false, reason: "This build does not contain the required secure SmartSpectra key." };
  return { available: true };
}
