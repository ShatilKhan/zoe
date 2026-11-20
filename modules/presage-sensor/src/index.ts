import { NativeModule, requireOptionalNativeModule, type EventSubscription } from "expo";

export type WellnessQuality = "acquiring" | "stable" | "poor";

export interface PresageSensorState {
  linked: boolean;
  configured: boolean;
  initialized: boolean;
  consented: boolean;
  permissionGranted: boolean;
  ready: boolean;
  readiness: "unchecked" | "ready" | "limited" | "blocked" | "inconclusive";
  status: "unconfigured" | "consent-required" | "permission-required" | "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
  quality: WellnessQuality;
  fresh: boolean;
  capturedAt?: string | null;
  pulseRate?: number | null;
  pulseConfidence?: number | null;
  breathingRate?: number | null;
  breathingConfidence?: number | null;
  validation?: string | null;
  reason?: string | null;
  errorCode?: string | null;
  retryable: boolean;
}

type PresageSensorEvents = {
  onStateChange: (state: PresageSensorState) => void;
};

declare class PresageSensorNativeModule extends NativeModule<PresageSensorEvents> {
  configured: boolean;
  getStatus(): Promise<PresageSensorState>;
  setConsent(granted: boolean): Promise<PresageSensorState>;
  setApiKey(apiKey: string): Promise<PresageSensorState>;
  initialize(): Promise<PresageSensorState>;
  start(): Promise<PresageSensorState>;
  stop(): Promise<PresageSensorState>;
}

const nativeModule = requireOptionalNativeModule<PresageSensorNativeModule>("PresageSensor");
const unavailableState: PresageSensorState = {
  linked: false,
  configured: false,
  initialized: false,
  consented: false,
  permissionGranted: false,
  ready: false,
  readiness: "unchecked",
  status: "unconfigured",
  quality: "acquiring",
  fresh: false,
  reason: "SmartSpectra requires the Zoe Android preview build.",
  retryable: false,
};

const PresageSensor = {
  available: nativeModule?.configured === true,
  unavailableState,
  async getStatus(): Promise<PresageSensorState> {
    return nativeModule?.getStatus() ?? unavailableState;
  },
  async initialize(): Promise<PresageSensorState> {
    if (!nativeModule) throw new Error(unavailableState.reason ?? "SmartSpectra native module unavailable.");
    return nativeModule.initialize();
  },
  async setConsent(granted: boolean): Promise<PresageSensorState> {
    if (!nativeModule) return unavailableState;
    return nativeModule.setConsent(granted);
  },
  async setApiKey(apiKey: string): Promise<PresageSensorState> {
    if (!nativeModule) return unavailableState;
    return nativeModule.setApiKey(apiKey);
  },
  async start(): Promise<PresageSensorState> {
    if (!nativeModule) throw new Error(unavailableState.reason ?? "SmartSpectra native module unavailable.");
    return nativeModule.start();
  },
  async stop(): Promise<PresageSensorState> {
    return nativeModule?.stop() ?? unavailableState;
  },
  addStateListener(listener: (state: PresageSensorState) => void): EventSubscription | null {
    return nativeModule?.addListener("onStateChange", listener) ?? null;
  },
};

export default PresageSensor;
