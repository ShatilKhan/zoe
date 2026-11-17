import { requireNativeModule } from "expo";

export interface OpaqueMask { left: number; top: number; right: number; bottom: number; }
interface PrescriptionMaskNativeModule { createMaskedCopy(inputPath: string, outputPath: string, masks: OpaqueMask[]): Promise<string>; }
export default requireNativeModule<PrescriptionMaskNativeModule>("PrescriptionMask");
