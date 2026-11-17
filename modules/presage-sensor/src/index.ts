import { requireNativeModule } from "expo";

export interface WellnessSample {
  pulseRate?: number;
  breathingRate?: number;
  capturedAt: string;
  quality: "acquiring" | "stable" | "poor";
}

interface PresageSensorNativeModule {
  getStatus(): Promise<{ linked: boolean; reason: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export default requireNativeModule<PresageSensorNativeModule>("PresageSensor");
