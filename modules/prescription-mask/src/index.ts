import { requireNativeModule } from "expo";

export interface OpaqueMask { left: number; top: number; right: number; bottom: number; }
export interface DecodedImage { data: number[]; width: number; height: number; }
interface PrescriptionMaskNativeModule {
  createMaskedCopy(inputPath: string, outputPath: string, masks: OpaqueMask[]): Promise<string>;
  decodeImageToRgb(inputPath: string): Promise<DecodedImage>;
}
export default requireNativeModule<PrescriptionMaskNativeModule>("PrescriptionMask");
